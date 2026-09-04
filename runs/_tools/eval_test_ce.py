"""Held-out TEST token cross-entropy, base vs every checkpoint, for the two fixed-harness
Harvard runs — phase3_token_loss protocol: sorted test rows, stride-sampled to 128 clips,
eval mode, identical rows for every model within a condition. Each run is scored on its own
condition's test tokens (raw model on raw tokens, denoised model on denoised tokens), with
base scored on both; plus a small cross-check of each run's best checkpoint on the other
condition's tokens. Also collects the val CE column from each run's loss.csv.

Writes runs/<run>/test_ce.json and runs/_tools/harvard_fixed_harness_results.json.
Usage (cwd = apps/ai-service, ~/ai/musicgen-env): python -u runs/_tools/eval_test_ce.py
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "apps/ai-service"))

import numpy as np  # noqa: E402
import torch  # noqa: E402
from transformers import AutoProcessor  # noqa: E402

from scripts.phase2_train import build_model, load_split, micro_step, set_dataset  # noqa: E402

CONDITIONS = {
    "harvard_raw": (REPO / "data/captions.jsonl", REPO / "data/tokens"),
    "harvard_denoised": (REPO / "data/captions_denoised.jsonl", REPO / "data/tokens_denoised"),
}
STEPS = [250, 500, 750, 1000, 1250, 1500]
N_CLIPS = 128


def test_rows() -> list[dict]:
    rows = sorted(load_split("test"), key=lambda r: r["clip_path"])
    return rows[:: max(1, len(rows) // N_CLIPS)][:N_CLIPS]


def score(ckpt: Path | None, tok, rows) -> float:
    model = build_model(str(ckpt) if ckpt else None)
    model.eval()
    with torch.no_grad():
        losses = [micro_step(model, tok, r).item() for r in rows]
    del model
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()
    return round(float(np.mean(losses)), 4)


def val_from_csv(run: str) -> dict[str, float]:
    out: dict[str, float] = {}
    with open(REPO / "runs" / run / "loss.csv") as f:
        for row in csv.DictReader(f):
            if row["val_loss"]:
                out[row["step"]] = float(row["val_loss"])
    return out


def sec_per_step(run: str) -> float | None:
    vals = []
    with open(REPO / "runs" / run / "loss.csv") as f:
        for row in csv.DictReader(f):
            if row["sec_per_step"]:
                vals.append(float(row["sec_per_step"]))
    return round(float(np.median(vals)), 2) if vals else None


def main() -> None:
    tok = AutoProcessor.from_pretrained("facebook/musicgen-small").tokenizer
    results: dict = {"n_test_clips": N_CLIPS, "runs": {}, "cross": {}}
    for run, (cap, tokens) in CONDITIONS.items():
        run_dir = REPO / "runs" / run
        if not (run_dir / "loss.csv").exists():
            print(f"{run}: no loss.csv, skipping", flush=True)
            continue
        set_dataset(str(cap), str(tokens))
        rows = test_rows()
        test_ce = {"base": score(None, tok, rows)}
        print(f"[{run}] base test CE {test_ce['base']}", flush=True)
        for s in STEPS:
            ckpt = run_dir / f"ckpt_step_{s:04d}"
            if ckpt.exists():
                test_ce[f"step_{s}"] = score(ckpt, tok, rows)
                print(f"[{run}] step {s} test CE {test_ce[f'step_{s}']}", flush=True)
        val = val_from_csv(run)
        best_val_step = min((k for k in val if k != "0"), key=lambda k: val[k]) if val else None
        best_test_key = min((k for k in test_ce if k != "base"), key=lambda k: test_ce[k]) if len(test_ce) > 1 else None
        entry = {
            "captions": str(cap.relative_to(REPO)), "tokens": str(tokens.relative_to(REPO)),
            "val_ce": val, "test_ce": test_ce,
            "best_val_step": best_val_step, "best_test_ckpt": best_test_key,
            "median_sec_per_step": sec_per_step(run),
        }
        summ = run_dir / "train_run_summary.json"
        if summ.exists():
            entry["sample"] = json.loads(summ.read_text())
        results["runs"][run] = entry
        (run_dir / "test_ce.json").write_text(json.dumps(entry, indent=2))

    # cross-check: each run's best-test checkpoint on the OTHER condition's test tokens
    runs = results["runs"]
    for run, other in (("harvard_raw", "harvard_denoised"), ("harvard_denoised", "harvard_raw")):
        if run in runs and other in runs and runs[run]["best_test_ckpt"]:
            cap, tokens = CONDITIONS[other]
            set_dataset(str(cap), str(tokens))
            rows = test_rows()
            step = int(runs[run]["best_test_ckpt"].split("_")[1])
            ckpt = REPO / "runs" / run / f"ckpt_step_{step:04d}"
            v = score(ckpt, tok, rows)
            results["cross"][f"{run}@{other}_test"] = {"ckpt": f"step_{step}", "test_ce": v,
                                                        "base_on_these_tokens": runs[other]["test_ce"]["base"]}
            print(f"[cross] {run} step {step} on {other} test tokens: {v}", flush=True)

    out = REPO / "runs/_tools/harvard_fixed_harness_results.json"
    out.write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2), flush=True)
    print("EVAL_DONE", flush=True)


if __name__ == "__main__":
    main()
