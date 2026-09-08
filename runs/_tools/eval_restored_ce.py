"""Transfer test for the spectral-subtraction restoration (the same protocol that
condemned DeepFilterNet on 2026-09-03, eval_test_ce.py): held-out TEST token
cross-entropy, 128 stride-sampled clips, eval mode.

  restored condition : base and every harvard_restored checkpoint on restored test tokens
  cross-check        : the best restored checkpoint on RAW test tokens, against the base
                       model on raw tokens (4.8363) and the raw-trained adapters; and the
                       raw-trained 1500-step adapter on restored tokens.

The decisive number is the cross-check: an adapter trained on restored clips that is
better than base on the untouched tapes has learned the music, not the processing.
DeepFilterNet's adapter scored 4.8705 there, worse than base.

Writes runs/harvard_restored/test_ce.json.
Usage (cwd = apps/ai-service, ~/ai/musicgen-env): python -u runs/_tools/eval_restored_ce.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "apps/ai-service"))

import numpy as np  # noqa: E402
import torch  # noqa: E402
from transformers import AutoProcessor  # noqa: E402

from scripts.phase2_train import build_model, load_split, micro_step, set_dataset  # noqa: E402

RAW = (REPO / "data/captions.jsonl", REPO / "data/tokens")
RESTORED = (REPO / "data/captions_restored.jsonl", REPO / "data/tokens_restored")
RUN = REPO / "runs/harvard_restored"
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


def main() -> None:
    tok = AutoProcessor.from_pretrained("facebook/musicgen-small").tokenizer
    out: dict = {"n_test_clips": N_CLIPS}

    set_dataset(str(RESTORED[0]), str(RESTORED[1]))
    rows_r = test_rows()
    restored = {"base": score(None, tok, rows_r)}
    print(f"[restored tokens] base {restored['base']}", flush=True)
    for s in STEPS:
        ckpt = RUN / f"ckpt_step_{s:04d}"
        if ckpt.exists():
            restored[f"step_{s}"] = score(ckpt, tok, rows_r)
            print(f"[restored tokens] step {s} {restored[f'step_{s}']}", flush=True)
    best = min((k for k in restored if k != "base"), key=lambda k: restored[k])
    raw1500 = REPO / "runs/harvard_raw/ckpt_step_1500"
    if raw1500.exists():
        restored["raw_adapter_step_1500"] = score(raw1500, tok, rows_r)
        print(f"[restored tokens] raw-trained adapter (1500) {restored['raw_adapter_step_1500']}", flush=True)
    out["restored_tokens"] = restored
    out["best_restored_ckpt"] = best

    set_dataset(str(RAW[0]), str(RAW[1]))
    rows_raw = test_rows()
    step = int(best.split("_")[1])
    cross = {"base": score(None, tok, rows_raw),
             f"restored_adapter_{best}": score(RUN / f"ckpt_step_{step:04d}", tok, rows_raw)}
    print(f"[raw tokens] base {cross['base']}  restored-trained adapter ({best}) {cross[f'restored_adapter_{best}']}", flush=True)
    prior = REPO / "runs/_tools/harvard_fixed_harness_results.json"
    if prior.exists():
        p = json.loads(prior.read_text())
        cross["reference_from_2026-09-03"] = {
            "raw_adapter_on_raw_1500": p.get("runs", {}).get("harvard_raw", {}).get("test_ce", {}).get("step_1500"),
            "denoised_adapter_on_raw": p.get("cross", {}).get("harvard_denoised->harvard_raw"),
        }
    out["raw_tokens"] = cross
    out["verdict"] = ("restoration transfers: the restored-trained adapter beats base on raw audio"
                      if cross[f"restored_adapter_{best}"] < cross["base"]
                      else "restoration does not transfer: worse than base on raw audio")
    (RUN / "test_ce.json").write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2), flush=True)
    print("EVAL_RESTORED_DONE", flush=True)


if __name__ == "__main__":
    main()
