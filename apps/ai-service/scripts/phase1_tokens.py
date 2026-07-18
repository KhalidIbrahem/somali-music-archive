"""Phase 1 step 6: precompute EnCodec tokens for every clip, once.

Uses facebook/encodec_32khz — the exact audio tokenizer MusicGen-small trains
on (4 codebooks @ 50 Hz, codebook size 2048). Each clip becomes an int16 array
of shape (4, 750) at data/tokens/<clip_stem>.npy. Resumable: existing .npy
files are skipped.

Usage: python3 -m scripts.phase1_tokens [--smoke N]  (from apps/ai-service)
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
CAPTIONS = REPO / "data/captions.jsonl"
TOKENS_DIR = REPO / "data/tokens"

BATCH = 8
EXPECT_FRAMES = 750  # 15 s * 50 Hz
EXPECT_CODEBOOKS = 4


def pick_device() -> str:
    return "mps" if torch.backends.mps.is_available() else "cpu"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", type=int, default=0, help="only encode N clips and report rate")
    args = ap.parse_args()

    clips = [REPO / json.loads(l)["clip_path"] for l in open(CAPTIONS)]
    if args.smoke:
        clips = clips[: args.smoke]
    todo = [c for c in clips if not (TOKENS_DIR / f"{c.stem}.npy").exists()]
    print(f"{len(clips)} clips, {len(todo)} to encode", flush=True)
    if not todo:
        return

    device = pick_device()
    model = EncodecModel.from_pretrained("facebook/encodec_32khz").to(device).eval()
    TOKENS_DIR.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    done = 0
    with torch.no_grad():
        for i in range(0, len(todo), BATCH):
            batch = todo[i : i + BATCH]
            audio = np.stack([sf.read(p, dtype="float32")[0] for p in batch])
            x = torch.from_numpy(audio).unsqueeze(1).to(device)  # (B, 1, T)
            enc = model.encode(x, bandwidth=2.2)
            codes = enc.audio_codes  # (chunks=1, B, K, F)
            assert codes.shape[0] == 1, f"unexpected chunking: {tuple(codes.shape)}"
            codes = codes[0].cpu().numpy().astype(np.int16)  # (B, K, F)
            assert codes.shape[1:] == (EXPECT_CODEBOOKS, EXPECT_FRAMES), tuple(codes.shape)
            for p, c in zip(batch, codes):
                np.save(TOKENS_DIR / f"{p.stem}.npy", c)
            done += len(batch)
            if device == "mps" and done % 400 == 0:
                torch.mps.empty_cache()
            if done % 80 == 0 or done == len(todo):
                rate = done / (time.time() - t0)
                eta_min = (len(todo) - done) / rate / 60
                print(f"{done}/{len(todo)}  {rate:.1f} clips/s  ETA {eta_min:.0f} min", flush=True)

    dt = time.time() - t0
    print(json.dumps({
        "device": device,
        "encoded": done,
        "seconds": round(dt, 1),
        "clips_per_s": round(done / dt, 2),
        "token_shape": [EXPECT_CODEBOOKS, EXPECT_FRAMES],
        "dtype": "int16",
    }, indent=2), flush=True)


if __name__ == "__main__":
    sys.exit(main())
