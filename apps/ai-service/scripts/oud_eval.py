"""Evaluate the fixed-harness oud LoRA run against base MusicGen.

Three stages, one process (sequential MPS use):
  1. Held-out TEST token CE — base vs ckpt_0500 (best val) vs ckpt_1000 —
     on a stride-sampled 128-clip subset, identical rows for every model.
  2. Base-model renders of the run's own 4 sample captions → the missing A/B
     partner for the per-checkpoint samples already on disk.
  3. N paired 10 s generations (base vs best ckpt) on seeded test captions →
     data/oud_eval_gen/{base,lora500}/ for PCS + listening.

Usage (from apps/ai-service):
  python3 -m scripts.oud_eval --stage ce
  python3 -m scripts.oud_eval --stage base-samples
  python3 -m scripts.oud_eval --stage gen --n 24
"""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from transformers import AutoProcessor

from scripts.phase2_train import build_model, load_split, micro_step, set_dataset

REPO = Path(__file__).resolve().parents[3]
RUN = REPO / "runs/oud_lora_r16_nodrop_20260809"
BEST_CKPT = RUN / "ckpt_step_0500"
FINAL_CKPT = RUN / "ckpt_step_1000"
# Under data/eval_gen so phase3_pcs_run scores the groups untouched.
GEN_ROOT = REPO / "data/eval_gen"
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
SECONDS = 10


def use_oud_dataset() -> None:
    set_dataset(str(REPO / "data/oud_captions.jsonl"), str(REPO / "data/oud_tokens"))


def stage_ce() -> None:
    use_oud_dataset()
    tok = AutoProcessor.from_pretrained("facebook/musicgen-small").tokenizer
    rows = sorted(load_split("test"), key=lambda r: r["clip_path"])
    rows = rows[:: max(1, len(rows) // 128)][:128]
    results: dict[str, float] = {}
    for name, ckpt in [("base", None), ("lora_step0500", BEST_CKPT), ("lora_step1000", FINAL_CKPT)]:
        model = build_model(str(ckpt) if ckpt else None)
        model.eval()
        with torch.no_grad():
            losses = [micro_step(model, tok, r).item() for r in rows]
        results[name] = round(float(np.mean(losses)), 4)
        print(f"{name}: test CE {results[name]} ({len(rows)} clips)", flush=True)
        del model
        if DEVICE == "mps":
            torch.mps.empty_cache()
    out = REPO / "data/oud_eval_test_ce.json"
    out.write_text(json.dumps({"n_clips": len(rows), "test_ce": results}, indent=2))
    print(json.dumps(results, indent=2), flush=True)


@torch.no_grad()
def render(model, processor, captions: list[str], out_dir: Path, start_index: int = 0) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    sr = model.config.audio_encoder.sampling_rate
    for b in range(0, len(captions), 2):  # batch 2: the safe MPS CFG batch
        chunk = captions[b:b + 2]
        inputs = processor(text=chunk, padding=True, return_tensors="pt").to(DEVICE)
        audio = model.generate(**inputs, do_sample=True, guidance_scale=3.0,
                               max_new_tokens=SECONDS * 50)
        for i, wav in enumerate(audio.cpu().numpy()):
            sf.write(out_dir / f"gen_{start_index + b + i:03d}.wav", wav.squeeze(), sr,
                     subtype="PCM_16")
        if DEVICE == "mps":
            torch.mps.empty_cache()
        print(f"  {out_dir.name}: {min(b + 2, len(captions))}/{len(captions)}", flush=True)


def stage_base_samples() -> None:
    processor = AutoProcessor.from_pretrained("facebook/musicgen-small")
    captions = (RUN / "sample_captions.txt").read_text().splitlines()
    torch.manual_seed(42)
    model = build_model(None)
    model.eval()
    t0 = time.time()
    render(model, processor, captions, RUN / "samples" / "base")
    print(f"base renders of the run's 4 sample captions in {time.time() - t0:.0f}s", flush=True)


def stage_gen(n: int) -> None:
    use_oud_dataset()
    processor = AutoProcessor.from_pretrained("facebook/musicgen-small")
    rows = sorted(load_split("test"), key=lambda r: r["clip_path"])
    rng = random.Random(42)
    # Distinct captions, seeded — identical prompt list for both groups.
    unique = sorted({r["caption"] for r in rows})
    captions = rng.sample(unique, min(n, len(unique)))
    for group, ckpt in [("oud_base", None), ("oud_lora500", BEST_CKPT)]:
        out_dir = GEN_ROOT / group
        out_dir.mkdir(parents=True, exist_ok=True)
        # phase3_pcs_run contract: {filename: caption} inside the group dir.
        (out_dir / "captions_index.json").write_text(json.dumps(
            {f"gen_{i:03d}.wav": caption for i, caption in enumerate(captions)}, indent=2))
        torch.manual_seed(42)  # same sampling noise budget per group
        model = build_model(str(ckpt) if ckpt else None)
        model.eval()
        t0 = time.time()
        render(model, processor, captions, out_dir)
        print(f"{group}: {len(captions)} x {SECONDS}s in {time.time() - t0:.0f}s", flush=True)
        del model
        if DEVICE == "mps":
            torch.mps.empty_cache()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", required=True, choices=["ce", "base-samples", "gen"])
    ap.add_argument("--n", type=int, default=24)
    args = ap.parse_args()
    if args.stage == "ce":
        stage_ce()
    elif args.stage == "base-samples":
        stage_base_samples()
    else:
        stage_gen(args.n)


if __name__ == "__main__":
    main()
