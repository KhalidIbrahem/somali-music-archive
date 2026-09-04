"""Check a smoke-run log (and recompute the base validation CE) against the recorded numbers.

The smoke run itself does not compute the 64-clip base validation loss, so this script
recomputes it with the same code path (build_model + micro_step, eval mode) and compares to
the value every oud run recorded at step 0: 4.5132. Exit 0 = reproduced.

Usage (from apps/ai-service):
  python -m scripts.check_smoke ../../runs/<run>.log --captions ... --tokens-dir ...
"""
from __future__ import annotations

import argparse
import re
import sys

import numpy as np
import torch
from transformers import AutoProcessor

from scripts import phase2_train as t

EXPECTED = {"dropout_attrs": 37, "lora_modules": 192, "trainable_m": 6.29, "base_val_ce": 4.5132, "base_val_tol": 0.002}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("log")
    ap.add_argument("--captions", required=True)
    ap.add_argument("--tokens-dir", required=True)
    args = ap.parse_args()
    text = open(args.log).read()
    checks: list[tuple[str, bool, str]] = []

    m = re.search(r"functional dropout zeroed on (\d+) attrs", text)
    checks.append(("37 functional-dropout attrs zeroed", bool(m) and int(m.group(1)) == EXPECTED["dropout_attrs"], m.group(1) if m else "not found"))
    m = re.search(r"lora_modules=(\d+) trainable=([\d.]+)M", text)
    checks.append(("192 LoRA sites", bool(m) and int(m.group(1)) == EXPECTED["lora_modules"], m.group(1) if m else "not found"))
    checks.append(("6.29 M trainable", bool(m) and abs(float(m.group(2)) - EXPECTED["trainable_m"]) < 0.01, m.group(2) if m else "not found"))
    m = re.search(r"step 10/50 loss=([\d.]+)", text)
    first = float(m.group(1)) if m else None
    checks.append(("train loss at step 10 is near eval loss (< 6.0; broken harness gave ~9.5)", first is not None and first < 6.0, f"{first}"))
    m = re.search(r'"val8_loss_after_smoke": ([\d.]+)', text)
    checks.append(("smoke completed with a val8 loss", bool(m), m.group(1) if m else "not found"))

    t.set_dataset(args.captions, args.tokens_dir)
    torch.manual_seed(t.HP["seed"])
    tok = AutoProcessor.from_pretrained(t.HP["model"]).tokenizer
    model = t.build_model()
    val_all = t.load_split("val")
    stride = max(1, len(val_all) // t.HP["val_clips"])
    rows = sorted(val_all, key=lambda r: r["clip_path"])[::stride][: t.HP["val_clips"]]
    model.eval()
    with torch.no_grad():
        v0 = float(np.mean([t.micro_step(model, tok, r).item() for r in rows]))
    checks.append((f"base+zero-init-LoRA val CE on {len(rows)} clips = {EXPECTED['base_val_ce']} ± {EXPECTED['base_val_tol']}", abs(v0 - EXPECTED["base_val_ce"]) <= EXPECTED["base_val_tol"], f"{v0:.4f}"))

    ok = all(c[1] for c in checks)
    for name, passed, got in checks:
        print(f"{'PASS' if passed else 'FAIL'}  {name}  (got {got})")
    print("REPRODUCED" if ok else "NOT REPRODUCED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
