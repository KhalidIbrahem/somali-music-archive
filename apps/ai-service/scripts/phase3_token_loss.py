"""Phase 3: held-out token-level cross-entropy on the TEST split, base vs LoRA.

Fixed 128-clip stride-sampled subset of the test split, identical for every
model, eval mode. Reuses the phase-2 label construction (delay pattern).

Usage (from apps/ai-service): python3 -m scripts.phase3_token_loss
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import torch

from scripts.phase2_train import build_model, load_split, micro_step
from transformers import AutoProcessor

REPO = Path(__file__).resolve().parents[3]
RUN = REPO / "runs/lora_r16_20260717"
N_CLIPS = 128


def main() -> None:
    tok = AutoProcessor.from_pretrained("facebook/musicgen-small").tokenizer
    rows = sorted(load_split("test"), key=lambda r: r["clip_path"])
    rows = rows[:: max(1, len(rows) // N_CLIPS)][:N_CLIPS]
    results = {}
    for name, ckpt in [("base", None),
                       ("lora_step1000", RUN / "ckpt_step_1000"),
                       ("lora_step1500", RUN / "ckpt_step_1500")]:
        model = build_model(str(ckpt) if ckpt else None)
        model.eval()
        with torch.no_grad():
            losses = [micro_step(model, tok, r).item() for r in rows]
        results[name] = round(float(np.mean(losses)), 4)
        print(f"{name}: test CE {results[name]} ({len(rows)} clips)", flush=True)
        del model
        if torch.backends.mps.is_available():
            torch.mps.empty_cache()
    out = REPO / "data/eval_pcs/test_token_ce.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"n_clips": len(rows), "test_ce": results}, indent=2))
    print(json.dumps(results, indent=2), flush=True)


if __name__ == "__main__":
    main()
