"""Render docs/eval/AHMED_TABLES.md and the two Ahmed figures from the run
artifacts on disk. Nothing in the report is typed by hand; a run that has not
happened renders as "not run". Rerun after every stage of
runs/_tools/orchestrate_ahmed.sh.

Sources per run: runs/<run>/eval_<tag>.json (scale_eval), loss.csv, config.json
(base model, LoRA rank / alpha, the captions file) and that captions file (for
the corpus sets: clips, songs and hours per source). The prior Harvard-only /
full-corpus adapters (qaraami_medium_r32, qaraami_large_r32, harvard_raw_3000)
are read the same way for the "versus the prior adapters" table;
harvard_raw_3000 carries test_ce.json instead of an eval JSON.

Hours per source are the SOURCE-audio hours: the set card's
"- Source audio: N h" line (build_sets.py, manifest / inventory durations) when
the set has one, otherwise "~N h" estimated from the clip count — the builders
cut 50 %-overlapping windows, so n clips of w seconds cover about
(n + songs) × w / 2 seconds, not n × w (the full 30 s corpus: 9,662 clips over
311 songs → ~41.6 h against the documented 43 h; Harvard's 11,386 15 s clips
over 119 tracks → ~24 h as documented).

Figures (matplotlib, Agg): docs/figures/ahmed_loss_curves.png (val CE per
checkpoint and smoothed train loss per Ahmed run) and ahmed_ce_improvement.png
(per-song test CE improvement base − adapter with its bootstrap 95% CI, Ahmed
runs against the prior adapters).

Usage (from apps/ai-service):
  python -m scripts.ahmed_report
  python -m scripts.ahmed_report --runs-dir ../../runs --data-dir ../../data \
     --out ../../docs/eval/AHMED_TABLES.md --figures-dir ../../docs/figures
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

import matplotlib
import soundfile as sf

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
CLIP_SECONDS = 30.0
OVERLAP = 0.5  # build_scale_dataset / build_sets / phase1_preprocess: hop = window / 2
NOT_RUN = "not run"

# the Stage 3-4 runs in orchestrator order, then the prior adapters; every
# descriptor (model, rank, alpha, corpus) is read from the run's own files
AHMED_RUNS = ["ahmed_only", "ahmed_only_large", "combined_large", "ahmed_melody"]
PRIOR_RUNS = ["qaraami_medium_r32", "qaraami_large_r32", "harvard_raw_3000"]

# categorical palette (dataviz reference instance, fixed slot order, never cycled)
SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]
PRIOR_COLOR = "#8a8984"
INK, INK_2, GRID = "#0b0b0b", "#52514e", "#e6e5e1"

SOURCE_AUDIO_RE = re.compile(r"^\s*-\s*Source audio:\s*(\d+(?:\.\d+)?)\s*h\b")


@dataclass
class RunRecord:
    """Everything the tables and figures need about one run; `present` is False
    when the run directory carries no eval JSON (rendered as "not run")."""
    run: str
    present: bool = False
    model: str = ""
    recipe: str = ""                  # "r32, α64" from config.json, "" when unknown
    corpus: str = ""
    best_ckpt: str = ""
    ce: dict | None = None            # per_song_ce block of the eval JSON
    ab: dict | None = None            # ab block minus pairs
    headtohead: dict | None = None
    val_curve: dict[int, float] = field(default_factory=dict)
    train_curve: dict[int, float] = field(default_factory=dict)
    ab_dir: str = ""


def f(x, nd: int = 4) -> str:
    return "–" if x is None else f"{x:.{nd}f}"


def signed(x, nd: int = 3) -> str:
    return "–" if x is None else f"{x:+.{nd}f}"


def read_json(path: Path) -> dict | None:
    return json.loads(path.read_text()) if path.exists() else None


def read_eval(run_dir: Path) -> dict | None:
    """runs/<run>/eval_<run>.json first, else the first eval_*.json by name."""
    own = run_dir / f"eval_{run_dir.name}.json"
    if own.exists():
        return read_json(own)
    found = sorted(run_dir.glob("eval_*.json"))
    return read_json(found[0]) if found else None


def read_loss(run_dir: Path) -> tuple[dict[int, float], dict[int, float]]:
    val: dict[int, float] = {}
    train: dict[int, float] = {}
    path = run_dir / "loss.csv"
    if not path.exists():
        return val, train
    with open(path) as fh:
        for row in csv.DictReader(fh):
            try:
                step = int(row["step"])
            except (KeyError, ValueError):
                continue
            if row.get("val_loss"):
                val[step] = float(row["val_loss"])
            if row.get("train_loss"):
                train[step] = float(row["train_loss"])
    return val, train


def resolve_captions(cfg_path: str | None) -> Path | None:
    """config.json stores the --captions argument as given: absolute, or relative
    to apps/ai-service (the scripts' cwd), or repo-relative."""
    if not cfg_path:
        return None
    p = Path(cfg_path)
    for cand in (p, REPO / "apps/ai-service" / p, REPO / p):
        if cand.exists():
            return cand
    return None


def set_card_hours(data_dir: Path, set_name: str) -> float | None:
    """The source-audio hours of data/sets/<set>/SET_CARD.md, from its
    "- Source audio: N h (...)" line (build_sets.write_set_card); None without a
    card or that line. The card's "- Clips: n × 30 s = N h" line is the window
    total, twice the audio, and is deliberately not read."""
    card = data_dir / "sets" / set_name / "SET_CARD.md"
    if not card.exists():
        return None
    for line in card.read_text().splitlines():
        m = SOURCE_AUDIO_RE.match(line)
        if m:
            return float(m.group(1))
    return None


def estimate_hours(clips: int, songs: int, clip_seconds: float = CLIP_SECONDS, overlap: float = OVERLAP) -> float:
    """Audio hours covered by `clips` windows cut with `overlap` over `songs`
    sources: each clip adds one hop, and every song adds the first window's
    remainder. With 50 % overlap that is (clips + songs) × w / 2."""
    hop = clip_seconds * (1.0 - overlap)
    return (clips * hop + songs * (clip_seconds - hop)) / 3600.0


def corpus_summary(captions: Path | None, data_dir: Path, clip_seconds: float = CLIP_SECONDS) -> str:
    """'ahmed_oud 812 clips (5.4 h), harvard_full 3081 clips (~13.0 h)' from the
    run captions: the set card's source-audio hours when the set has a card,
    else the overlap-aware estimate marked "~". Rows of the older captions files
    carry no "source"; their "rights" key or "unlabelled" stands in."""
    if captions is None:
        return "captions file missing"
    clips: dict[str, int] = {}
    songs: dict[str, set[str]] = {}
    with open(captions) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            name = row.get("source") or row.get("rights") or "unlabelled"
            clips[name] = clips.get(name, 0) + 1
            songs.setdefault(name, set()).add(str(row.get("song_sha256") or row.get("clip_path")))
    parts = []
    for name in sorted(clips):
        hours = set_card_hours(data_dir, name)
        if hours is None:
            parts.append(f"{name} {clips[name]} clips (~{estimate_hours(clips[name], len(songs[name]), clip_seconds):.1f} h)")
        else:
            parts.append(f"{name} {clips[name]} clips ({hours:.1f} h)")
    return ", ".join(parts) if parts else "empty captions"


def recipe_from_config(cfg: dict) -> str:
    """'r32, α64' from config.json's rank / alpha; '' when the run recorded none."""
    rank, alpha = cfg.get("rank"), cfg.get("alpha")
    if rank is None and alpha is None:
        return ""
    return ", ".join(p for p in (f"r{rank}" if rank is not None else "", f"α{alpha}" if alpha is not None else "") if p)


def ab_seconds(ab: dict | None, ab_dir: str) -> float | None:
    """The A/B clip length: the eval JSON's ab.seconds, else measured from
    pair000_base.wav in the A/B directory, else unknown (never a typed default)."""
    if ab and ab.get("seconds") is not None:
        return float(ab["seconds"])
    wav = Path(ab_dir) / "pair000_base.wav" if ab_dir else None
    if wav is not None and wav.exists():
        try:
            return float(sf.info(str(wav)).duration)
        except RuntimeError:
            return None
    return None


def load_run(runs_dir: Path, data_dir: Path, run: str) -> RunRecord:
    rec = RunRecord(run=run)
    run_dir = runs_dir / run
    cfg = read_json(run_dir / "config.json") or {}
    rec.recipe = recipe_from_config(cfg)
    rec.val_curve, rec.train_curve = read_loss(run_dir)
    ev = read_eval(run_dir)
    if ev is not None:
        rec.present = True
        rec.model = ev.get("model") or cfg.get("model", "")
        rec.best_ckpt = ev.get("best_ckpt", "")
        rec.ce = ev.get("per_song_ce")
        ab = ev.get("ab") or {}
        rec.ab = {k: v for k, v in ab.items() if k != "pairs"}
        rec.ab_dir = ab.get("dir", "")
        rec.headtohead = ev.get("headtohead")
    else:
        tce = read_json(run_dir / "test_ce.json")
        if tce is not None:  # the small-model harness: test_ce.json (no CI, no A/B scoring)
            rec.present = True
            rec.model = cfg.get("model", "")
            best = tce.get("best_test_ckpt") or ""
            rec.best_ckpt = best.replace("step_", "ckpt_step_") if best else ""
            base = tce.get("test_ce", {}).get("base")
            adapter = tce.get("test_ce", {}).get(best) if best else None
            rec.ce = {"n_songs": None, "base": {"mean": base, "ci95": None}, "adapter": {"mean": adapter, "ci95": None},
                      "improvement_base_minus_adapter": {"mean": (base - adapter) if base is not None and adapter is not None else None,
                                                          "ci95": None, "significant": None}}
    if rec.present:
        # the small-model harness stored the token frame count (750 = 15 s); scale runs are 30 s clips
        clip_seconds = float(cfg["frames"]) / 50.0 if cfg.get("frames") else CLIP_SECONDS
        rec.corpus = corpus_summary(resolve_captions(cfg.get("captions")), data_dir, clip_seconds)
    return rec


def ce_cell(ce: dict | None) -> str:
    if not ce:
        return "–"
    imp = ce.get("improvement_base_minus_adapter") or {}
    ci = imp.get("ci95")
    ci_txt = f" [{ci[0]:.3f}, {ci[1]:.3f}]" if ci else ""
    n = ce.get("n_songs")
    n_txt = f", n = {n} songs" if n else ", clip mean, no CI"
    return f"{f(ce['base']['mean'])} → {f(ce['adapter']['mean'])} (Δ {signed(imp.get('mean'))}{ci_txt}{n_txt})"


def ab_cell(ab: dict | None, key: str, nd: int) -> str:
    if not ab or not ab.get("base") or not ab.get("adapter"):
        return "–"
    return f"{f(ab['base'].get(key), nd)} → {f(ab['adapter'].get(key), nd)}"


def rel(path: str) -> str:
    try:
        return str(Path(path).relative_to(REPO))
    except ValueError:
        return path


def model_cell(rec: RunRecord) -> str:
    name = rec.model.replace("facebook/", "")
    return f"{name} ({rec.recipe})" if rec.recipe else name


def results_row(rec: RunRecord) -> str:
    if not rec.present:
        return f"| {rec.run} | {NOT_RUN} | | | | | | |"
    if rec.ab and rec.ab_dir:
        secs = ab_seconds(rec.ab, rec.ab_dir)
        ab_txt = f"`{rel(rec.ab_dir)}/` ({rec.ab.get('n')} pairs, {f(secs, 0) + ' s' if secs is not None else 'length –'})"
    else:
        ab_txt = "–"
    return (f"| {rec.run} | {model_cell(rec)} | {rec.corpus} | {rec.best_ckpt or '–'} | {ce_cell(rec.ce)} | "
            f"{ab_cell(rec.ab, 'voiced_fraction_mean', 3)} | {ab_cell(rec.ab, 'pcs_mean', 4)} | {ab_txt} |")


RESULTS_HEADER = ("| run | base model (LoRA) | corpus sets (clips, source audio h) | best ckpt | per-song test CE base → adapter | "
                  "trackable melody base → adapter | PCS base → adapter | A/B set |\n"
                  "| --- | --- | --- | --- | --- | --- | --- | --- |")


def sources_cell(h: dict) -> str:
    """'ahmed_mix 5, ahmed_oud 9' (songs per shared source) from a head-to-head
    block; an older block without the breakdown says so."""
    srcs = h.get("sources")
    if not srcs:
        return "all test sources (no breakdown recorded)"
    return ", ".join(f"{s} {v.get('songs', '–')}" for s, v in sorted(srcs.items()))


def headtohead_rows(recs: list[RunRecord]) -> list[str]:
    rows = []
    for rec in recs:
        h = rec.headtohead
        if not rec.present or not h:
            continue
        d = h.get("difference_other_minus_this") or {}
        ci = d.get("ci95") or [None, None]
        verdict = ("this run lower CE" if d.get("significant") and (d.get("mean") or 0) > 0
                   else "other run lower CE" if d.get("significant") else "no significant difference")
        rows.append(f"| {rec.run} ({rec.best_ckpt}) | {Path(h.get('other_run', '')).name} ({h.get('other_ckpt', '')}) | "
                    f"{sources_cell(h)} | "
                    f"{f((h.get('this') or {}).get('mean'))} | {f((h.get('other') or {}).get('mean'))} | "
                    f"{signed(d.get('mean'))} [{f(ci[0], 3)}, {f(ci[1], 3)}] | {h.get('n_songs', '–')} | {verdict} |")
        for src, ps in sorted((h.get("per_source") or {}).items()):
            pd = ps.get("difference_other_minus_this") or {}
            pci = pd.get("ci95") or [None, None]
            pv = ("this run lower CE" if pd.get("significant") and (pd.get("mean") or 0) > 0
                  else "other run lower CE" if pd.get("significant") else "no significant difference")
            rows.append(f"| ↳ {src} only | | {src} {ps.get('n_songs', '–')} | {f((ps.get('this') or {}).get('mean'))} | "
                        f"{f((ps.get('other') or {}).get('mean'))} | {signed(pd.get('mean'))} [{f(pci[0], 3)}, {f(pci[1], 3)}] | "
                        f"{ps.get('n_songs', '–')} | {pv} |")
    return rows


def build_report(runs_dir: Path, data_dir: Path, figures_rel: str = "../figures") -> tuple[str, list[RunRecord], list[RunRecord]]:
    ahmed = [load_run(runs_dir, data_dir, r) for r in AHMED_RUNS]
    prior = [load_run(runs_dir, data_dir, r) for r in PRIOR_RUNS]
    out = ["# Ahmed Ilkacase corpus — Stage 3-4 results", "",
           f"*Generated by `apps/ai-service/scripts/ahmed_report.py` on {time.strftime('%Y-%m-%d')} from `runs/*/eval_*.json`, "
           "`loss.csv` and `config.json`; nothing typed by hand. Per-song test CE is the mean token cross-entropy over the "
           "held-out test songs (song-level split), with a bootstrap 95% CI over songs on the improvement base − adapter. "
           "Trackable melody is the mean CREPE voiced fraction and PCS the pentatonic conformity of the generated A/B clips "
           "(same captions and seeds on both sides). Corpus hours are source-audio hours: the set card's figure, or `~` an "
           "estimate from the 50 %-overlap clip count. Consented Ahmed sets only; Harvard rows are research-only and never served.*",
           "", "## T1 — Ahmed-corpus runs", "", RESULTS_HEADER]
    out += [results_row(r) for r in ahmed]
    out += ["", "## T2 — Head-to-head (paired per-song CE on the test songs of the sources both runs trained on, "
            "other − this; positive = this run's adapter has the lower CE)", "",
            "| run | versus | shared sources (songs) | this CE | other CE | Δ other − this [95% CI] | songs | verdict |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    h2h = headtohead_rows(ahmed)
    out += h2h or [f"| {NOT_RUN} | | | | | | | |"]
    out += ["", "## T3 — Prior adapters (Harvard-only and full-corpus, same metrics)", "", RESULTS_HEADER]
    out += [results_row(r) for r in prior]
    out += ["", "## Figures", "",
            f"![validation and training loss per Ahmed run]({figures_rel}/ahmed_loss_curves.png)", "",
            f"![per-song test CE improvement with 95% CI]({figures_rel}/ahmed_ce_improvement.png)", ""]
    return "\n".join(out), ahmed, prior


def _style(ax) -> None:
    ax.spines[["top", "right"]].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)
    ax.tick_params(colors=INK_2, labelsize=9)
    ax.grid(True, axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def smooth(curve: dict[int, float], window: int = 50) -> tuple[list[int], list[float]]:
    steps = sorted(curve)
    vals = [curve[s] for s in steps]
    out = []
    for i in range(len(vals)):
        lo = max(0, i - window + 1)
        out.append(sum(vals[lo:i + 1]) / (i + 1 - lo))
    return steps, out


def fig_loss_curves(recs: list[RunRecord], path: Path) -> None:
    fig, (ax_v, ax_t) = plt.subplots(2, 1, figsize=(8, 7), sharex=True)
    drawn = 0
    for rec, color in zip(recs, SERIES):
        if not rec.val_curve and not rec.train_curve:
            continue
        drawn += 1
        vs = sorted(rec.val_curve)
        ax_v.plot(vs, [rec.val_curve[s] for s in vs], color=color, linewidth=2, marker="o", markersize=4, label=rec.run)
        ts, tv = smooth(rec.train_curve)
        if ts:
            ax_t.plot(ts, tv, color=color, linewidth=1.6, label=rec.run)
    for ax, title in ((ax_v, "validation CE per checkpoint"), (ax_t, "training loss (50-step running mean)")):
        _style(ax)
        ax.set_title(title, loc="left", fontsize=11, color=INK)
        ax.set_ylabel("token cross-entropy", color=INK_2, fontsize=9)
    ax_t.set_xlabel("optimizer step", color=INK_2, fontsize=9)
    if drawn:
        ax_v.legend(frameon=False, fontsize=9, labelcolor=INK_2)
    else:
        ax_v.text(0.5, 0.5, "no Ahmed run has a loss.csv yet", ha="center", va="center", color=INK_2, transform=ax_v.transAxes)
    fig.suptitle("Ahmed corpus runs — loss curves", x=0.02, ha="left", fontsize=13, color=INK)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def fig_ce_improvement(ahmed: list[RunRecord], prior: list[RunRecord], path: Path) -> None:
    labels, means, err_lo, err_hi, colors = [], [], [], [], []
    for group, color in ((ahmed, SERIES[0]), (prior, PRIOR_COLOR)):
        for rec in group:
            labels.append(rec.run)
            colors.append(color)
            imp = (rec.ce or {}).get("improvement_base_minus_adapter") or {}
            m = imp.get("mean")
            ci = imp.get("ci95")
            means.append(m if m is not None else 0.0)
            err_lo.append((m - ci[0]) if (m is not None and ci) else 0.0)
            err_hi.append((ci[1] - m) if (m is not None and ci) else 0.0)
    fig, ax = plt.subplots(figsize=(8, 0.5 * len(labels) + 1.8))
    y = list(range(len(labels)))[::-1]
    ax.barh(y, means, color=colors, height=0.55, edgecolor="none")
    ax.errorbar(means, y, xerr=[err_lo, err_hi], fmt="none", ecolor=INK_2, elinewidth=1, capsize=3)
    for yi, rec in zip(y, ahmed + prior):
        imp = (rec.ce or {}).get("improvement_base_minus_adapter") or {}
        if not rec.present:
            ax.text(0.002, yi, NOT_RUN, va="center", ha="left", fontsize=9, color=INK_2)
        elif imp.get("mean") is not None:
            ci = imp.get("ci95")
            txt = f"{imp['mean']:+.3f}" + (f" [{ci[0]:.3f}, {ci[1]:.3f}]" if ci else "")
            ax.text(max(imp["mean"], 0) + (err_hi[y.index(yi)] if ci else 0) + 0.003, yi, txt, va="center", ha="left", fontsize=8.5, color=INK_2)
    ax.axvline(0, color=INK_2, linewidth=1)
    ax.set_yticks(y)
    ax.set_yticklabels(labels, fontsize=9, color=INK)
    _style(ax)
    ax.grid(True, axis="x", color=GRID, linewidth=0.8)
    ax.grid(False, axis="y")
    ax.set_xlabel("per-song test CE improvement, base − adapter (nats/token, 95% bootstrap CI over songs)", color=INK_2, fontsize=9)
    from matplotlib.patches import Patch
    ax.legend(handles=[Patch(color=SERIES[0], label="Ahmed corpus adapters"), Patch(color=PRIOR_COLOR, label="prior adapters")],
              frameon=False, fontsize=9, labelcolor=INK_2, loc="upper center", bbox_to_anchor=(0.5, -0.16), ncol=2)
    ax.set_title("Per-song test CE improvement, Ahmed corpus adapters against the prior adapters", loc="left", fontsize=11, color=INK)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def write_report(runs_dir: Path, data_dir: Path, out: Path, figures_dir: Path) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    figures_dir.mkdir(parents=True, exist_ok=True)
    try:
        figures_rel = str(Path(figures_dir.resolve()).relative_to(out.parent.resolve()))
    except ValueError:
        figures_rel = "../figures"
    md, ahmed, prior = build_report(runs_dir, data_dir, figures_rel)
    fig_loss_curves(ahmed, figures_dir / "ahmed_loss_curves.png")
    fig_ce_improvement(ahmed, prior, figures_dir / "ahmed_ce_improvement.png")
    out.write_text(md)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs-dir", default=str(REPO / "runs"))
    ap.add_argument("--data-dir", default=str(REPO / "data"))
    ap.add_argument("--out", default=str(REPO / "docs/eval/AHMED_TABLES.md"))
    ap.add_argument("--figures-dir", default=str(REPO / "docs/figures"))
    args = ap.parse_args()
    out = write_report(Path(args.runs_dir), Path(args.data_dir), Path(args.out), Path(args.figures_dir))
    print(f"wrote {out} and {Path(args.figures_dir) / 'ahmed_loss_curves.png'}, {Path(args.figures_dir) / 'ahmed_ce_improvement.png'}")


if __name__ == "__main__":
    main()
