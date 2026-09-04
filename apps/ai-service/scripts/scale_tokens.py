"""Precompute EnCodec tokens for the 30-second scale clips.

facebook/encodec_32khz — the tokenizer every MusicGen size shares (4 codebooks
@ 50 Hz, codebook 2048). A 30 s clip → (4, 1500) int16 at
data/scale_tokens/<clip_stem>.npy. Resumable (existing .npy skipped). Frames
are asserted against the clip length so a mismatched clip is caught, not
silently padded.

Usage (from apps/ai-service):
  python -m scripts.scale_tokens --captions ../../data/scale_captions.jsonl \
      --tokens-dir ../../data/scale_tokens --seconds 30
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from transformers import EncodecModel

REPO = Path(__file__).resolve().parents[3]
BATCH = 4
CODEBOOKS = 4


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--captions", required=True)
    ap.add_argument("--tokens-dir", required=True)
    ap.add_argument("--seconds", type=float, default=30.0)
    ap.add_argument("--smoke", type=int, default=0)
    args = ap.parse_args()
    frames = int(round(args.seconds * 50))
    tokens_dir = Path(args.tokens_dir)
    tokens_dir.mkdir(parents=True, exist_ok=True)

    rows = [json.loads(l) for l in open(args.captions)]
    clips = [REPO / r["clip_path"] for r in rows]
    if args.smoke:
        clips = clips[: args.smoke]
    todo = [c for c in clips if not (tokens_dir / f"{c.stem}.npy").exists()]
    print(f"{len(clips)} clips, {len(todo)} to encode, expect (4, {frames})", flush=True)
    if not todo:
        return

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = EncodecModel.from_pretrained("facebook/encodec_32khz").to(device).eval()
    t0 = time.time()
    done = 0
    with torch.no_grad():
        for i in range(0, len(todo), BATCH):
            batch = todo[i:i + BATCH]
            arrs = [sf.read(p, dtype="float32")[0] for p in batch]
            n = min(len(a) for a in arrs)
            audio = np.stack([a[:n] for a in arrs])
            x = torch.from_numpy(audio).unsqueeze(1).to(device)
            enc = model.encode(x, bandwidth=2.2)
            codes = enc.audio_codes[0].cpu().numpy().astype(np.int16)
            for p, c in zip(batch, codes):
                if c.shape != (CODEBOOKS, frames):
                    # trim/pad to the expected frame count (edge clips can be ±1)
                    fixed = np.zeros((CODEBOOKS, frames), dtype=np.int16)
                    k = min(frames, c.shape[1])
                    fixed[:, :k] = c[:, :k]
                    c = fixed
                np.save(tokens_dir / f"{p.stem}.npy", c)
            done += len(batch)
            if done % 40 == 0 or done >= len(todo):
                rate = done / (time.time() - t0)
                print(f"{done}/{len(todo)}  {rate:.1f} clips/s  ETA {(len(todo) - done) / rate / 60:.0f} min", flush=True)
    print(json.dumps({"encoded": done, "seconds": round(time.time() - t0, 1), "frames": frames}), flush=True)


if __name__ == "__main__":
    sys.exit(main())
