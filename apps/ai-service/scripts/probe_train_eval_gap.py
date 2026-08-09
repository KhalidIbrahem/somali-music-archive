"""Probe: why does train-mode loss (~9.4) dwarf eval-mode loss (~4.5) at
identical (base + zero-init LoRA) weights?

Three runs (Harvard lr 1e-4 / 2e-5, oud lr 1e-5) all show the same signature:
val is fine at step 100, exploded by step 250, and the TRAIN curve converges
toward the same ~7.2 — i.e. optimization fits a forward path that differs
from the eval path. This probe measures the same clips' loss under toggled
factors to find the corrupting component:

  A. eval mode (reference — matches val_loss)
  B. full train mode (what training optimizes)
  C. train mode, dropout zeroed everywhere
  D. train mode, gradient checkpointing disabled
  E. train mode, text+audio encoders forced to eval (decoder-only train)

Usage (from apps/ai-service):
  python3 -m scripts.probe_train_eval_gap --captions ../../data/oud_captions.jsonl \
      --tokens-dir ../../data/oud_tokens
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from peft import LoraConfig, get_peft_model
from transformers import AutoProcessor, MusicgenForConditionalGeneration

from scripts import phase2_train as t

DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
N_CLIPS = 4
BOS = 2048


def fresh_model(gradient_checkpointing: bool) -> torch.nn.Module:
    model = MusicgenForConditionalGeneration.from_pretrained(
        "facebook/musicgen-small", torch_dtype=torch.float32
    )
    model.config.decoder.decoder_start_token_id = BOS
    if gradient_checkpointing:
        model.decoder.gradient_checkpointing_enable(
            gradient_checkpointing_kwargs={"use_reentrant": False}
        )
    lcfg = LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05,
                      target_modules=["q_proj", "k_proj", "v_proj", "out_proj"], bias="none")
    return get_peft_model(model, lcfg).to(DEVICE)


def zero_all_dropout(model: torch.nn.Module) -> int:
    n = 0
    for module in model.modules():
        if isinstance(module, torch.nn.Dropout):
            module.p = 0.0
            n += 1
    return n


@torch.no_grad()
def mean_loss(model, tok, rows) -> float:
    return float(np.mean([t.micro_step(model, tok, r).item() for r in rows]))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--captions", required=True)
    ap.add_argument("--tokens-dir", required=True)
    args = ap.parse_args()
    t.set_dataset(args.captions, args.tokens_dir)

    torch.manual_seed(42)
    processor = AutoProcessor.from_pretrained("facebook/musicgen-small")
    tok = processor.tokenizer
    rows = sorted(t.load_split("val"), key=lambda r: r["clip_path"])[:N_CLIPS]
    print(f"probing {len(rows)} val clips on {DEVICE}", flush=True)

    results: dict[str, float] = {}

    model = fresh_model(gradient_checkpointing=True)

    model.eval()
    results["A_eval_mode"] = mean_loss(model, tok, rows)
    print(f"A eval mode (reference)          : {results['A_eval_mode']:.4f}", flush=True)

    model.train()
    results["B_train_mode_full"] = mean_loss(model, tok, rows)
    print(f"B train mode (as trained)        : {results['B_train_mode_full']:.4f}", flush=True)

    n_dropout = zero_all_dropout(model)
    results["C_train_no_dropout"] = mean_loss(model, tok, rows)
    print(f"C train, dropout->0 ({n_dropout:3d} mods)  : {results['C_train_no_dropout']:.4f}",
          flush=True)

    del model
    if DEVICE == "mps":
        torch.mps.empty_cache()

    model = fresh_model(gradient_checkpointing=False)
    model.train()
    results["D_train_no_checkpointing"] = mean_loss(model, tok, rows)
    print(f"D train, no grad-checkpointing   : {results['D_train_no_checkpointing']:.4f}",
          flush=True)

    model.text_encoder.eval()
    model.audio_encoder.eval()
    results["E_train_decoder_only"] = mean_loss(model, tok, rows)
    print(f"E train, encoders eval           : {results['E_train_decoder_only']:.4f}", flush=True)

    print(json.dumps(results, indent=2), flush=True)


if __name__ == "__main__":
    main()
