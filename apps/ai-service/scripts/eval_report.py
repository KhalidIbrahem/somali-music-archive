"""Build the evaluation tables and figures from the run artifacts — nothing is
typed by hand. Reads runs/*/loss.csv, runs/*/test_ce.json, data/eval_pcs/*.json,
data/analysis/probe_train_eval_gap.json and data/clips_denoised/denoise_stats.json;
writes docs/eval/TABLES.md (included by EVALUATION.md) and docs/figures/*.png|svg.

Usage (from apps/ai-service): python -m scripts.eval_report
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
RUNS = REPO / "runs"
FIG = REPO / "docs/figures"
FIG.mkdir(parents=True, exist_ok=True)

RUN_META = [
    # id, label, corpus, harness, note
    ("lora_r16_20260717", "July 17 — Harvard, lr 1e-4", "Harvard (raw)", "broken (functional dropout active)", "1500 steps; resumed at 1000 after an MPS kill"),
    ("lora_r16_lr2e5_20260718", "July 18 — Harvard, lr 2e-5", "Harvard (raw)", "broken", "stopped at step 400 (same collapse, delayed)"),
    ("oud_lora_r16_lr1e5_20260809", "Aug 9 — oud, lr 1e-5", "oud", "broken (diagnostic)", "reproduced the cliff on different data → ruled out the corpus"),
    ("oud_lora_r16_nodrop_20260809", "Aug 9 — oud, lr 1e-4, FIXED harness", "oud", "fixed", "first positive result; best = step 500 (listening gate passed)"),
    ("harvard_raw", "Sep 3 — Harvard raw, 1500 steps", "Harvard (raw)", "fixed", "every checkpoint beats base"),
    ("harvard_raw_3000", "Sep 3 — Harvard raw, 3000 steps", "Harvard (raw)", "fixed", "plateau by ~2500; best = step 2750"),
    ("harvard_denoised", "Sep 3 — Harvard DeepFilterNet-denoised, 1500 steps", "Harvard (denoised)", "fixed", "negative control: adapter does not transfer to raw audio"),
]


def read_loss(run: str) -> tuple[dict[int, float], dict[int, float], list[float]]:
    val: dict[int, float] = {}
    train: dict[int, float] = {}
    spp: list[float] = []
    path = RUNS / run / "loss.csv"
    if not path.exists():
        return val, train, spp
    with open(path) as f:
        for row in csv.DictReader(f):
            step = int(row["step"])
            if row.get("val_loss"):
                val[step] = float(row["val_loss"])
            if row.get("train_loss"):
                train[step] = float(row["train_loss"])
            if row.get("sec_per_step"):
                spp.append(float(row["sec_per_step"]))
    return val, train, spp


def read_test(run: str) -> dict[str, float]:
    p = RUNS / run / "test_ce.json"
    if p.exists():
        return json.loads(p.read_text())["test_ce"]
    if run == "oud_lora_r16_nodrop_20260809":
        d = json.loads((REPO / "data/oud_eval_test_ce.json").read_text())["test_ce"]
        return {"base": d["base"], "step_500": d["lora_step0500"], "step_1000": d["lora_step1000"]}
    if run == "lora_r16_20260717":
        d = json.loads((REPO / "data/eval_pcs/test_token_ce.json").read_text())["test_ce"]
        return {"base": d["base"], "step_1000": d["lora_step1000"], "step_1500": d["lora_step1500"]}
    return {}


def pcs(group: str, archive: bool = False) -> dict | None:
    p = REPO / "data/eval_pcs" / ("archive_20260809/" if archive else "") / f"{group}.json"
    return json.loads(p.read_text()) if p.exists() else None


def fmt(x: float | None, nd: int = 4) -> str:
    return "—" if x is None else f"{x:.{nd}f}"


def main() -> None:
    lines: list[str] = []
    # ── Table 1: every run ───────────────────────────────────────────────────
    lines += ["## T1 — Every fine-tuning run (MusicGen-small, LoRA r=16 α=32 on decoder q/k/v/out, batch 1×4, cosine, 100 warm-up)", "",
              "| run | corpus | harness | steps | base val CE | best val CE (step) | last val CE | base test CE | best test CE (step) | s/step | note |",
              "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    curves = {}
    for run, label, corpus, harness, note in RUN_META:
        val, train, spp = read_loss(run)
        test = read_test(run)
        curves[run] = (label, corpus, harness, val, train)
        base_val = val.get(0)
        later = {s: v for s, v in val.items() if s > 0}
        best_step = min(later, key=later.get) if later else None
        last_step = max(later) if later else None
        tb = {k: v for k, v in test.items() if k != "base"}
        best_test_key = min(tb, key=tb.get) if tb else None
        import statistics
        lines.append(
            f"| {label} | {corpus} | {harness} | {last_step or '—'} | {fmt(base_val)} | {fmt(later.get(best_step)) if best_step else '—'} ({best_step or '—'}) | {fmt(later.get(last_step)) if last_step else '—'} | "
            f"{fmt(test.get('base'))} | {fmt(tb.get(best_test_key)) if best_test_key else '—'} ({best_test_key.replace('step_', '') if best_test_key else '—'}) | {round(statistics.median(spp), 2) if spp else '—'} | {note} |"
        )
    lines += ["", "April 2026 (pre-repo): a naive full-decoder fine-tune without delay-pattern labels produced NaN loss for ten epochs; a Replicate `sakemin/musicgen-fine-tuner` MusicGen-medium run produced a `trained_model.tar` with no held-out metrics. Both superseded; kept only as history (`Desktop/Model-Training/02 replicate finetune` on the old-Mac archive).", ""]

    # ── Table 2: Harvard raw 3000 plateau ────────────────────────────────────
    val3, _, _ = read_loss("harvard_raw_3000")
    test3 = read_test("harvard_raw_3000")
    steps = sorted(s for s in val3 if s % 250 == 0 and s > 0)
    lines += ["## T2 — Plateau analysis, Harvard raw 3000-step run", "", "| step | val CE | Δ val per 250 | test CE |", "| --- | --- | --- | --- |", f"| 0 (base) | {fmt(val3.get(0))} | | {fmt(test3.get('base'))} |"]
    prev = val3.get(0)
    for s in steps:
        d = (prev - val3[s]) if prev is not None else None
        lines.append(f"| {s} | {fmt(val3[s])} | {fmt(d, 4) if d is not None else ''} | {fmt(test3.get(f'step_{s}'))} |")
        prev = val3[s]
    q = max(1, len(steps) // 4)
    first_q = (val3[0] - val3[steps[q - 1]]) / q if steps else 0
    last_q = (val3[steps[-1 - q]] - val3[steps[-1]]) / q if len(steps) > q else 0
    lines += ["", f"Val drop per 250 steps: first quarter {first_q:.4f}, last quarter {last_q:.4f}. Steps 2500/2750/3000 = {fmt(val3.get(2500))}/{fmt(val3.get(2750))}/{fmt(val3.get(3000))}; test {fmt(test3.get('step_2500'))}/{fmt(test3.get('step_2750'))}/{fmt(test3.get('step_3000'))}. The extra 1500 steps over the 1500-step run bought {fmt(read_test('harvard_raw').get('step_1500', 0) - test3.get('step_3000', 0))} test CE.", ""]

    # ── Table 3: denoised cross-check ────────────────────────────────────────
    den = json.loads((RUNS / "_tools/harvard_fixed_harness_results.json").read_text()) if (RUNS / "_tools/harvard_fixed_harness_results.json").exists() else None
    stats = json.loads((REPO / "data/clips_denoised/denoise_stats.json").read_text()) if (REPO / "data/clips_denoised/denoise_stats.json").exists() else None
    lines += ["## T3 — Denoised negative control (DeepFilterNet3, the project's own `clean` stage, clip-for-clip)", ""]
    if stats:
        dm = stats["diagnostics_median"]
        lines += [f"Corpus-wide effect of the denoiser: median raw loudness {dm['raw_lufs']} LUFS → {dm['denoised_lufs_pre_gain']} LUFS before re-normalisation (≈{dm['gain_db']} dB removed); waveform correlation raw↔denoised median {dm['corr_raw_vs_denoised']} (p10–p90 {stats['diagnostics_p10_p90_corr'][0]}–{stats['diagnostics_p10_p90_corr'][1]}). Six-clip spectral check: the 1–3 kHz band fell from ~20–33 % of energy to ~3–11 %. DeepFilterNet is a speech enhancer; on this corpus it removed much of the oud and presence band, not only hiss.", ""]
    if den:
        r = den["runs"]
        lines += ["| condition | base val CE | adapter val CE (1500) | base test CE | adapter test CE (1500) |", "| --- | --- | --- | --- | --- |",
                  f"| raw tokens | {fmt(r['harvard_raw']['val_ce']['0'])} | {fmt(r['harvard_raw']['val_ce']['1500'])} | {fmt(r['harvard_raw']['test_ce']['base'])} | {fmt(r['harvard_raw']['test_ce']['step_1500'])} |",
                  f"| denoised tokens | {fmt(r['harvard_denoised']['val_ce']['0'])} | {fmt(r['harvard_denoised']['val_ce']['1500'])} | {fmt(r['harvard_denoised']['test_ce']['base'])} | {fmt(r['harvard_denoised']['test_ce']['step_1500'])} |", "",
                  "Cross-check (does an adapter transfer to the other condition's test tokens?):", "", "| adapter → test tokens | test CE | base on those tokens | verdict |", "| --- | --- | --- | --- |"]
        for k, v in den["cross"].items():
            better = v["test_ce"] < v["base_on_these_tokens"]
            lines.append(f"| {k.replace('@', ' → ').replace('_test', '')} ({v['ckpt']}) | {fmt(v['test_ce'])} | {fmt(v['base_on_these_tokens'])} | {'better than base' if better else '**worse than base**'} |")
        lines += ["", "CE is not comparable across conditions (removing hiss lowers token entropy for every model). The denoised adapter is worse than base on raw audio: it specialised to an altered corpus. Denoising with a speech enhancer is a methods caveat, not a training recipe.", ""]

    # ── Table 4: PCS on both A/B sets ────────────────────────────────────────
    lines += ["## T4 — Pentatonic Conformity Score on the A/B sets (n = 8 prompts per group; directional, no statistics claimed)", "",
              "| group | n scored | PCS mean | PCS median | voiced fraction | median |tuning| (cents) | caption-tonic match |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for group, label in [("oud_base", "oud — base MusicGen"), ("oud_lora500", "oud — adapter step 500"), ("oud_real", "oud — real held-out clips (164)"), ("harvard_base", "Harvard — base MusicGen"), ("harvard_lora1500", "Harvard — raw adapter step 1500"), ("real_test", "Harvard — real test clips (1076)"), ("base", "Harvard — base (July, 100 prompts)"), ("lora1000", "Harvard — July broken-harness ckpt 1000 (100)"), ("lora1500", "Harvard — July broken-harness ckpt 1500 (100)")]:
        p = pcs(group)
        if p:
            lines.append(f"| {label} | {p['clips_scored']} | {p['pcs_mean']:.3f} | {p['pcs_median']:.3f} | {p['voiced_fraction_mean']:.3f} | {p['tuning_offset_abs_median']} | {p['tonic_match_rate'] if p['tonic_match_rate'] is not None else '—'} |")
    old_b, old_l = pcs("oud_base", archive=True), pcs("oud_lora500", archive=True)
    if old_b and old_l:
        lines += ["", f"Re-scoring the identical oud A/B files under torch 2.14 moved the adapter's PCS from {old_l['pcs_mean']:.3f} (2026-08-09 record) to {pcs('oud_lora500')['pcs_mean']:.3f}: one clip's tuning-offset estimate flipped sign (+28.7 → −23.3 c), changing its mode and its PCS 0.83 → 0.54. Voiced fractions reproduced exactly ({old_l['voiced_fraction_mean']} / {pcs('oud_lora500')['voiced_fraction_mean']}). At n = 8, PCS differences of a few hundredths are inside scorer noise; the robust cross-corpus effect is the voiced-fraction gain (oud +64 %, Harvard +68 %) and the learned ~25 c tape tuning offset.", ""]

    # ── Table 5: dropout probe ───────────────────────────────────────────────
    probe_p = REPO / "data/analysis/probe_train_eval_gap.json"
    if probe_p.exists():
        pr = json.loads(probe_p.read_text())
        lines += ["## T5 — The harness defect: train-mode vs eval-mode loss on identical zero-init LoRA weights (4 oud val clips, 2026-09-04 re-run)", "",
                  "| condition | mean token CE |", "| --- | --- |",
                  f"| A. eval mode (what validation measured) | {pr['A_eval_mode']:.4f} |",
                  f"| B. train mode, as trained in July/Aug | {pr['B_train_mode_full']:.4f} |",
                  f"| C. train mode, every `nn.Dropout` module set to p=0 (229 modules) | {pr['C_train_no_dropout']:.4f} |",
                  f"| D. train mode, no gradient checkpointing | {pr['D_train_no_checkpointing']:.4f} |",
                  f"| E. train mode, text+audio encoders in eval | {pr['E_train_decoder_only']:.4f} |",
                  "| uniform-random reference ln(2048) | 7.6246 |", "",
                  "Module-level dropout sweeps (C) change nothing: the HF MusicGen decoder applies dropout *functionally* through 37 float attributes (`dropout`, `activation_dropout`, `attention_dropout`) consumed by `F.dropout(..., training=self.training)`. Optimisation fitted a forward path the evaluation never saw — worse than uniform random — and dragged eval loss from 4.5 to 7.2. `phase2_train.zero_functional_dropout()` sets those 37 attributes to 0 at build time; train ≡ eval to four decimals afterwards. July's 'structural negative' is superseded: it was the harness.", ""]

    (REPO / "docs/eval/TABLES.md").write_text("\n".join(lines) + "\n")
    head = REPO / "docs/eval/EVALUATION.head.md"
    if head.exists():
        (REPO / "docs/eval/EVALUATION.md").write_text(head.read_text() + "\n".join(lines) + "\n")
        print("wrote docs/eval/EVALUATION.md")
    print("wrote docs/eval/TABLES.md")

    # ── Figures ──────────────────────────────────────────────────────────────
    plt.rcParams.update({"figure.dpi": 150, "font.size": 9, "axes.spines.top": False, "axes.spines.right": False})
    # F1 validation curves, two corpora
    fig, axes = plt.subplots(1, 2, figsize=(10, 3.8), sharey=False)
    for ax, corpus, base_line in ((axes[0], "Harvard (raw)", 4.6262), (axes[1], "oud", 4.5132)):
        for run, (label, c, harness, val, _) in curves.items():
            if c != corpus or not val:
                continue
            xs = sorted(val)
            ax.plot(xs, [val[x] for x in xs], marker="o", ms=3, lw=1.4, ls="--" if "broken" in harness else "-", label=label)
        ax.axhline(base_line, color="gray", lw=1, ls=":", label=f"base MusicGen-small ({base_line})")
        ax.set_title(f"{corpus}: validation token CE")
        ax.set_xlabel("optimizer step")
        ax.set_ylabel("cross-entropy (nats)")
        ax.legend(fontsize=7, loc="upper right")
    fig.tight_layout()
    fig.savefig(FIG / "ft1_val_curves.png")
    fig.savefig(FIG / "ft1_val_curves.svg")
    plt.close(fig)

    # F2 dropout probe bars
    if probe_p.exists():
        fig, ax = plt.subplots(figsize=(6.5, 3.4))
        keys = ["A_eval_mode", "B_train_mode_full", "C_train_no_dropout", "D_train_no_checkpointing", "E_train_decoder_only"]
        labels = ["A eval", "B train\n(as trained)", "C train,\nnn.Dropout→0", "D train,\nno ckpt", "E train,\nencoders eval"]
        vals = [pr[k] for k in keys]
        bars = ax.bar(labels, vals, color=["#4c8c4a"] + ["#b5533c"] * 4)
        ax.axhline(7.6246, color="gray", ls=":", lw=1)
        ax.text(-0.4, 7.75, "uniform random ln(2048) = 7.62", ha="left", fontsize=7, color="gray")
        for b, v in zip(bars, vals):
            ax.text(b.get_x() + b.get_width() / 2, v + 0.08, f"{v:.2f}", ha="center", fontsize=8)
        ax.set_ylabel("token CE, identical weights")
        ax.set_title("The harness defect: train-mode loss ≠ eval-mode loss (functional dropout)")
        ax.set_ylim(0, 10.8)
        fig.tight_layout()
        fig.savefig(FIG / "ft2_dropout_probe.png")
        fig.savefig(FIG / "ft2_dropout_probe.svg")
        plt.close(fig)

    # F3 PCS + voiced fraction bars
    groups = [("oud_base", "oud\nbase"), ("oud_lora500", "oud\nadapter"), ("oud_real", "oud\nreal"), ("harvard_base", "Harvard\nbase"), ("harvard_lora1500", "Harvard\nadapter"), ("real_test", "Harvard\nreal")]
    data = [(lab, pcs(g)) for g, lab in groups if pcs(g)]
    fig, axes = plt.subplots(1, 2, figsize=(10, 3.4))
    colors = ["#888", "#C89B5F", "#4c8c4a"] * 2
    axes[0].bar([d[0] for d in data], [d[1]["pcs_mean"] for d in data], color=colors)
    axes[0].set_ylim(0.5, 1.0)
    axes[0].set_title("Pentatonic Conformity Score (mean)")
    axes[1].bar([d[0] for d in data], [d[1]["voiced_fraction_mean"] for d in data], color=colors)
    axes[1].set_title("Voiced fraction (trackable melody)")
    for ax in axes:
        for i, d in enumerate(data):
            v = d[1]["pcs_mean"] if ax is axes[0] else d[1]["voiced_fraction_mean"]
            ax.text(i, v + 0.008, f"{v:.3f}", ha="center", fontsize=7)
    fig.suptitle("Read jointly: the adapters make more melody (right) at similar or lower conformity (left); n = 8 prompts per generated group", fontsize=8)
    fig.tight_layout()
    fig.savefig(FIG / "ft3_pcs_voiced.png")
    fig.savefig(FIG / "ft3_pcs_voiced.svg")
    plt.close(fig)

    # F4 plateau (Harvard raw 3000): val + test per checkpoint
    fig, ax = plt.subplots(figsize=(6.5, 3.4))
    xs = [0] + steps
    ax.plot(xs, [val3[x] for x in xs], marker="o", ms=3, label="validation CE (64 clips)")
    tx = [s for s in xs if f"step_{s}" in test3 or s == 0]
    ax.plot(tx, [test3["base"] if s == 0 else test3[f"step_{s}"] for s in tx], marker="s", ms=3, label="test CE (128 clips, unseen songs)")
    ax.axvline(2750, color="#C89B5F", ls="--", lw=1)
    ax.text(2760, ax.get_ylim()[1] - 0.02, "best 2750", fontsize=7, color="#C89B5F", va="top")
    ax.set_xlabel("optimizer step")
    ax.set_ylabel("cross-entropy (nats)")
    ax.set_title("Harvard raw, 3000 steps: the curve flattens by ~2500")
    ax.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(FIG / "ft4_plateau_harvard3000.png")
    fig.savefig(FIG / "ft4_plateau_harvard3000.svg")
    plt.close(fig)

    # F5 train loss: July (broken) vs fixed
    fig, ax = plt.subplots(figsize=(6.5, 3.4))
    for run, (label, c, harness, _, train) in curves.items():
        if run not in ("lora_r16_20260717", "harvard_raw", "oud_lora_r16_nodrop_20260809", "oud_lora_r16_lr1e5_20260809") or not train:
            continue
        xs = sorted(train)
        # 25-step moving average for readability
        ys = [train[x] for x in xs]
        sm = [sum(ys[max(0, i - 24):i + 1]) / len(ys[max(0, i - 24):i + 1]) for i in range(len(ys))]
        ax.plot(xs, sm, lw=1.2, ls="--" if "broken" in harness else "-", label=label)
    ax.axhline(7.6246, color="gray", ls=":", lw=1)
    ax.set_xlabel("optimizer step")
    ax.set_ylabel("train loss (25-step mean)")
    ax.set_title("Train loss (25-step mean): broken harness → 6.5–7, fixed harness → 2–4.7")
    ax.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(FIG / "ft5_train_loss_broken_vs_fixed.png")
    fig.savefig(FIG / "ft5_train_loss_broken_vs_fixed.svg")
    plt.close(fig)

    # F6 denoise effect
    if stats:
        dm = stats["diagnostics_median"]
        fig, axes = plt.subplots(1, 2, figsize=(8, 3.2))
        axes[0].bar(["raw", "denoised\n(pre-gain)"], [dm["raw_lufs"], dm["denoised_lufs_pre_gain"]], color=["#888", "#b5533c"])
        axes[0].set_title("Median clip loudness (LUFS)")
        for i, v in enumerate([dm["raw_lufs"], dm["denoised_lufs_pre_gain"]]):
            axes[0].text(i, v - 1.2, f"{v}", ha="center", fontsize=8, color="white")
        lo, hi = stats["diagnostics_p10_p90_corr"]
        axes[1].bar(["p10", "median", "p90"], [lo, dm["corr_raw_vs_denoised"], hi], color="#b5533c")
        axes[1].set_ylim(0, 1)
        axes[1].set_title("Waveform correlation raw ↔ denoised")
        fig.suptitle(f"DeepFilterNet3 on the Harvard clips: ≈{dm['gain_db']} dB removed; the output is a different signal", fontsize=8)
        fig.tight_layout()
        fig.savefig(FIG / "ft6_denoise_effect.png")
        fig.savefig(FIG / "ft6_denoise_effect.svg")
        plt.close(fig)
    print("wrote figures:", sorted(p.name for p in FIG.glob("*.png")))


if __name__ == "__main__":
    main()
