"""Phase 3: generate evaluation audio from base / fine-tuned MusicGen.

Uses a fixed, seeded selection of 100 distinct test-split captions (identical
across model groups, saved alongside the audio) so PCS comparisons are paired.

Usage (from apps/ai-service):
  python3 -m scripts.phase3_generate --group base
  python3 -m scripts.phase3_generate --group lora1000 --ckpt ../../runs/lora_r16_20260717/ckpt_step_1000
  python3 -m scripts.phase3_generate --group lora1500 --ckpt ../../runs/lora_r16_20260717/ckpt_step_1500
"""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import soundfile as sf
import torch
from transformers import AutoProcessor, MusicgenForConditionalGeneration

REPO = Path(__file__).resolve().parents[3]
CAPTIONS = REPO / "data/captions.jsonl"
OUT_ROOT = REPO / "data/eval_gen"

N = 100
SECONDS = 10
# batch 4 ballooned the MPS driver to ~17 GB and macOS repeatedly killed the
# job under memory pressure; batch 2 halves the transient peak
BATCH = 2
SEED = 42
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"


def pick_captions() -> list[str]:
    # the test split has only 72 distinct caption strings (captions cluster by
    # song tonic/genre), so sample clip-level captions: duplicates are fine and
    # mirror the corpus distribution
    rows = [json.loads(l) for l in open(CAPTIONS) if json.loads(l)["split"] == "test"]
    caps = sorted(r["caption"] for r in rows)
    return random.Random(SEED).sample(caps, N)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--group", required=True)
    ap.add_argument("--ckpt", default=None)
    args = ap.parse_args()

    out_dir = OUT_ROOT / args.group
    out_dir.mkdir(parents=True, exist_ok=True)
    captions = pick_captions()
    (out_dir / "captions_index.json").write_text(json.dumps(
        {f"gen_{i:03d}.wav": c for i, c in enumerate(captions)}, indent=1))

    processor = AutoProcessor.from_pretrained("facebook/musicgen-small")
    model = MusicgenForConditionalGeneration.from_pretrained(
        "facebook/musicgen-small", torch_dtype=torch.float32)
    model.config.decoder.decoder_start_token_id = 2048
    if args.ckpt:
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, args.ckpt, is_trainable=False)
    model.to(DEVICE).eval()
    torch.manual_seed(SEED)

    sr = model.config.audio_encoder.sampling_rate if not args.ckpt \
        else model.base_model.model.config.audio_encoder.sampling_rate
    t0 = time.time()
    done = 0
    todo = [(i, c) for i, c in enumerate(captions)
            if not (out_dir / f"gen_{i:03d}.wav").exists()]
    print(f"[{args.group}] {len(todo)}/{N} to generate on {DEVICE}", flush=True)
    with torch.no_grad():
        for b in range(0, len(todo), BATCH):
            batch = todo[b:b + BATCH]
            inputs = processor(text=[c for _, c in batch], padding=True,
                               return_tensors="pt").to(DEVICE)
            audio = model.generate(**inputs, do_sample=True, guidance_scale=3.0,
                                   max_new_tokens=SECONDS * 50)
            for (i, _), wav in zip(batch, audio.cpu().numpy()):
                sf.write(out_dir / f"gen_{i:03d}.wav", wav.squeeze(), sr, subtype="PCM_16")
            done += len(batch)
            if DEVICE == "mps":
                torch.mps.empty_cache()
            print(f"[{args.group}] {done}/{len(todo)} "
                  f"({(time.time()-t0)/max(done,1):.1f}s/clip)", flush=True)
    print(f"[{args.group}] done in {(time.time()-t0)/60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
