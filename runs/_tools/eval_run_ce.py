"""Held-out TEST token CE, base vs every checkpoint of ONE run (phase3_token_loss protocol:
sorted test rows, stride-sampled to 128 clips, eval mode, identical rows for every model),
plus the val-CE column from loss.csv, median sec/step, and a curve-flattening summary.
Checkpoints are auto-discovered (runs/<run>/ckpt_step_*). Writes runs/<run>/test_ce.json.

Usage (cwd = apps/ai-service, ~/ai/musicgen-env):
  python -u runs/_tools/eval_run_ce.py --run harvard_raw_3000 [--captions ... --tokens-dir ...]
"""
from __future__ import annotations

import argparse
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

N_CLIPS = 128


def score(ckpt: Path | None, tok, rows) -> float:
    model = build_model(str(ckpt) if ckpt else None)
    model.eval()
    with torch.no_grad():
        losses = [micro_step(model, tok, r).item() for r in rows]
    del model
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()
    return round(float(np.mean(losses)), 4)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--captions", default=str(REPO / "data/captions.jsonl"))
    ap.add_argument("--tokens-dir", default=str(REPO / "data/tokens"))
    args = ap.parse_args()
    run_dir = REPO / "runs" / args.run
    set_dataset(args.captions, args.tokens_dir)
    tok = AutoProcessor.from_pretrained("facebook/musicgen-small").tokenizer
    rows = sorted(load_split("test"), key=lambda r: r["clip_path"])
    rows = rows[:: max(1, len(rows) // N_CLIPS)][:N_CLIPS]

    ckpts = sorted(run_dir.glob("ckpt_step_*"), key=lambda p: int(p.name.split("_")[-1]))
    test_ce = {"base": score(None, tok, rows)}
    print(f"[{args.run}] base test CE {test_ce['base']}", flush=True)
    for c in ckpts:
        step = int(c.name.split("_")[-1])
        test_ce[f"step_{step}"] = score(c, tok, rows)
        print(f"[{args.run}] step {step} test CE {test_ce[f'step_{step}']}", flush=True)

    val, spp = {}, []
    with open(run_dir / "loss.csv") as f:
        for row in csv.DictReader(f):
            if row["val_loss"]:
                val[row["step"]] = float(row["val_loss"])
            if row["sec_per_step"]:
                spp.append(float(row["sec_per_step"]))
    best_val_step = min((k for k in val if k != "0"), key=lambda k: val[k]) if val else None
    best_test = min((k for k in test_ce if k != "base"), key=lambda k: test_ce[k]) if ckpts else None

    # flattening: per-250-step drop over the last quarter of the run vs the first quarter
    steps = sorted((int(k) for k in val if k != "0" and int(k) % 250 == 0))
    flat = None
    if len(steps) >= 4:
        q = max(1, len(steps) // 4)
        first = (val[str(steps[0])] - val[str(steps[q])]) / q
        last = (val[str(steps[-1 - q])] - val[str(steps[-1])]) / q
        flat = {"val_drop_per_ckpt_first_quarter": round(first, 5),
                "val_drop_per_ckpt_last_quarter": round(last, 5),
                "last_three_val": {str(s): val[str(s)] for s in steps[-3:]},
                "last_three_test": {f"step_{s}": test_ce.get(f"step_{s}") for s in steps[-3:]}}

    entry = {"run": args.run, "n_test_clips": len(rows), "captions": args.captions,
             "tokens": args.tokens_dir, "val_ce": val, "test_ce": test_ce,
             "best_val_step": best_val_step, "best_test_ckpt": best_test,
             "median_sec_per_step": round(float(np.median(spp)), 2) if spp else None,
             "mean_sec_per_step": round(float(np.mean(spp)), 2) if spp else None,
             "flattening": flat}
    summ = run_dir / "train_run_summary.json"
    if summ.exists():
        entry["sample"] = json.loads(summ.read_text())
    (run_dir / "test_ce.json").write_text(json.dumps(entry, indent=2))
    print(json.dumps(entry, indent=2), flush=True)
    print("EVAL_DONE", flush=True)


if __name__ == "__main__":
    main()
