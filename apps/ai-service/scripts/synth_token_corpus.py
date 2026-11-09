"""Synthetic pentatonic melodies as EnCodec tokens, for pretraining and transcription research.

Renders melodies with the generator in `synth_somali_bench.py` at 32 kHz, in its
five conditions, and encodes each 17-second clip with facebook/encodec_32khz
(the tokenizer every MusicGen size shares: 4 codebooks at 50 Hz, codebook 2048),
giving a fixed (4, 850) array of codes per clip. Everything is synthesised here,
so nothing derives from a recording. Audio is not kept: each item has its own
seed, so any clip can be regenerated exactly.

Resumable, one shard per 500 melodies, and it waits on AC power before each shard.

    python -m scripts.synth_token_corpus --out ../../dist/token_corpus --items 10000
"""
from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import subprocess
import time
from pathlib import Path

import numpy as np

from scripts import synth_somali_bench as synth

SR = 32000
CLIP_SECONDS = 17
CLIP_SAMPLES = SR * CLIP_SECONDS
FRAMES = 50 * CLIP_SECONDS
CODEBOOKS = 4
TOKENS_PER_CLIP = CODEBOOKS * FRAMES
REGISTERS = ("oud", "voice_low", "voice_high")
SHARD_ITEMS = 500
BASE_SEED = 20261108


def fit_clip(x: np.ndarray) -> np.ndarray:
    """Peak-normalise as the benchmark does, then pad the tail to the fixed clip length."""
    if len(x) > CLIP_SAMPLES:
        raise ValueError(f"clip of {len(x)} samples exceeds {CLIP_SAMPLES}")
    y = np.zeros(CLIP_SAMPLES, dtype=np.float32)
    y[: len(x)] = (0.3 * x / np.abs(x).max()).astype(np.float32)
    return y


def render_item(index: int, seed: int = BASE_SEED) -> tuple[dict, np.ndarray]:
    """The melody at `index` and its five clips. Depends only on (seed, index)."""
    synth.SR = SR
    rng = np.random.default_rng([seed, index])
    register = REGISTERS[index % len(REGISTERS)]
    item, mixes = synth.make_item(rng, register)
    meta = {
        "item": index, "register": register, "tonic": item["tonic"], "scale_pcs": item["scale_pcs"],
        "bpm": round(item["bpm"], 4), "offset_cents": round(item["offset_cents"], 4),
        "length_sec": round(item["length"], 4), "notes": item["notes"],
    }
    return meta, np.stack([fit_clip(mixes[c]) for c in synth.CONDITIONS])


def _render(args: tuple[int, int]) -> tuple[dict, np.ndarray]:
    return render_item(*args)


def on_ac_power() -> bool:
    try:
        out = subprocess.run(["pmset", "-g", "batt"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return True
    return "AC Power" in out


def wait_for_ac(allow_battery: bool) -> None:
    announced = False
    while not allow_battery and not on_ac_power():
        if not announced:
            print("on battery: waiting for AC power", flush=True)
            announced = True
        time.sleep(30)
    if announced:
        print("AC power back: resuming", flush=True)


def encode_batch(model, device: str, clips: np.ndarray):
    import torch

    x = torch.from_numpy(clips).unsqueeze(1).to(device)
    with torch.inference_mode():
        codes = model.encode(x, bandwidth=2.2).audio_codes[0].cpu().numpy().astype(np.int16)
    if codes.shape[1:] != (CODEBOOKS, FRAMES):
        raise ValueError(f"unexpected code shape {codes.shape}")
    return codes


def build_shard(pool, model, device: str, shard: int, seed: int, out: Path, batch: int, items: int) -> int:
    first = shard * SHARD_ITEMS
    todo = [(i, seed) for i in range(first, min(first + SHARD_ITEMS, items))]
    metas, chunks, buf = [], [], []
    for meta, clips in pool.imap(_render, todo, chunksize=2):
        metas.append(meta)
        buf.append(clips)
        if sum(len(b) for b in buf) >= batch:
            chunks.append(encode_batch(model, device, np.concatenate(buf)))
            buf = []
    if buf:
        chunks.append(encode_batch(model, device, np.concatenate(buf)))
    codes = np.concatenate(chunks)
    if codes.shape[0] != len(todo) * len(synth.CONDITIONS):
        raise ValueError("clip count mismatch")
    tmp = out / f".tmp_{shard:05d}.npy"
    np.save(tmp, codes)
    (out / f"shard_{shard:05d}.jsonl").write_text("".join(json.dumps(m) + "\n" for m in metas), encoding="utf-8")
    os.replace(tmp, out / f"shard_{shard:05d}.npy")
    return codes.size


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--items", type=int, default=10000)
    ap.add_argument("--seed", type=int, default=BASE_SEED)
    ap.add_argument("--workers", type=int, default=14)
    ap.add_argument("--batch", type=int, default=25, help="clips per EnCodec batch")
    ap.add_argument("--allow-battery", action="store_true")
    args = ap.parse_args()
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    import torch
    from transformers import EncodecModel

    args.out.mkdir(parents=True, exist_ok=True)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = EncodecModel.from_pretrained("facebook/encodec_32khz").to(device).eval()
    shards = (args.items + SHARD_ITEMS - 1) // SHARD_ITEMS
    t0 = time.time()
    done = 0
    with mp.get_context("spawn").Pool(args.workers) as pool:
        for s in range(shards):
            if (args.out / f"shard_{s:05d}.npy").exists():
                continue
            wait_for_ac(args.allow_battery)
            t1 = time.time()
            n = build_shard(pool, model, device, s, args.seed, args.out, args.batch, args.items)
            done += n
            print(f"shard {s + 1}/{shards}: {n:,} tokens in {time.time() - t1:.0f} s; {done:,} this run; "
                  f"{(time.time() - t0) / 3600:.2f} h elapsed", flush=True)
    print("ALL_SHARDS_DONE", flush=True)


if __name__ == "__main__":
    main()
