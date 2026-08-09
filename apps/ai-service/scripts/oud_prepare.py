"""Prepare the oud (kaban) qaraami collection for MusicGen LoRA fine-tuning.

Same recipe as phase1_preprocess (32 kHz mono -> peak norm -> -14 LUFS ->
15 s / 50%-overlap segments, quiet segments dropped, measured tempo +
pentatonic tonic captions, song-level 80/10/10 split by sorted sha256) but a
SEPARATE dataset: the source is the privately shared oud-led collection, and
outputs live beside — never over — the Harvard artifacts:

  data/oud_clips/<split>/*.wav
  data/oud_captions.jsonl
  data/oud_dataset_card.json

Exact-duplicate source files (same bytes) are collapsed by sha256 before
processing. Captions keep the "rooted on <tonic>" phrase the training
harness's sample picker expects.

Usage (from apps/ai-service): python3 -m scripts.oud_prepare --src <folder>
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf

from scripts.pentatonic import detect_from_audio

REPO = Path(__file__).resolve().parents[3]
CLIPS_DIR = REPO / "data/oud_clips"
CAPTIONS = REPO / "data/oud_captions.jsonl"
CARD = REPO / "data/oud_dataset_card.json"

SR = 32000
CLIP_S = 15.0
WIN = int(CLIP_S * SR)
HOP = WIN // 2
PEAK = 0.99
TARGET_LUFS = -14.0
QUIET_DROP_DB = 20.0
AUDIO_EXT = {".mp3", ".m4a", ".wav", ".flac", ".aac"}


def decode_32k_mono(path: Path) -> np.ndarray:
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True, check=True,
    )
    return np.frombuffer(out.stdout, dtype=np.float32).copy()


def tempo_bpm(clip: np.ndarray) -> float:
    import librosa

    try:
        from librosa.feature.rhythm import tempo as _tempo
    except ImportError:  # older librosa
        _tempo = librosa.beat.tempo
    return float(_tempo(y=clip, sr=SR)[0])


def tempo_word(bpm: float) -> str:
    return "slow" if bpm < 80 else ("moderate" if bpm <= 120 else "lively")


def build_caption(bpm: float, tonic: str) -> str:
    return ", ".join([
        "Somali qaraami led by the oud (kaban)",
        f"{tempo_word(bpm)} at {round(bpm)} BPM",
        f"pentatonic melody rooted on {tonic}",
        "intimate home recording",
    ])


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def assign_splits(shas: list[str]) -> dict[str, str]:
    """Song-level 80/10/10 by sorted sha — deterministic, no song in two splits."""
    ordered = sorted(shas)
    n = len(ordered)
    n_val = max(1, round(n * 0.10))
    n_test = max(1, round(n * 0.10))
    split: dict[str, str] = {}
    for i, sha in enumerate(ordered):
        if i < n - n_val - n_test:
            split[sha] = "train"
        elif i < n - n_test:
            split[sha] = "val"
        else:
            split[sha] = "test"
    return split


def process_song(path: Path, sha: str, split: str) -> list[dict]:
    y = decode_32k_mono(path)
    if len(y) < WIN:
        return []
    y *= PEAK / max(float(np.abs(y).max()), 1e-9)
    loudness = pyln.Meter(SR).integrated_loudness(y.astype(np.float64))
    y = (y * (10.0 ** ((TARGET_LUFS - loudness) / 20.0))).astype(np.float32)

    tonic = detect_from_audio(y, SR)

    starts = list(range(0, len(y) - WIN + 1, HOP))
    rms_db = np.array([
        20 * np.log10(np.sqrt(np.mean(y[s:s + WIN] ** 2)) + 1e-12) for s in starts
    ])
    keep_mask = rms_db >= (np.median(rms_db) - QUIET_DROP_DB)

    out_dir = CLIPS_DIR / split
    out_dir.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []
    for i, (s, keep) in enumerate(zip(starts, keep_mask)):
        if not keep:
            continue
        clip = np.clip(y[s:s + WIN], -1.0, 1.0)
        clip_path = out_dir / f"{sha[:8]}_seg{i:03d}.wav"
        sf.write(clip_path, clip, SR, subtype="PCM_16")
        rows.append({
            "clip_path": str(clip_path.relative_to(REPO)),
            "caption": build_caption(tempo_bpm(clip), tonic["tonic_name"]),
            "song_sha256": sha,
            "split": split,
        })
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="folder of source audio files")
    args = ap.parse_args()
    src = Path(args.src).expanduser()

    files = sorted(p for p in src.rglob("*") if p.suffix.lower() in AUDIO_EXT)
    print(f"{len(files)} audio files found", flush=True)

    # Collapse byte-identical duplicates (the folder carries several "2"/"3" copies).
    by_sha: dict[str, Path] = {}
    for path in files:
        sha = sha256_file(path)
        by_sha.setdefault(sha, path)
    print(f"{len(by_sha)} unique songs after byte-dedupe", flush=True)

    splits = assign_splits(list(by_sha))
    all_rows: list[dict] = []
    per_song: list[dict] = []
    for n, (sha, path) in enumerate(sorted(by_sha.items(), key=lambda kv: kv[1].name), 1):
        rows = process_song(path, sha, splits[sha])
        all_rows.extend(rows)
        per_song.append({
            "sha256": sha[:16],
            "split": splits[sha],
            "clips": len(rows),
            "tonic": rows[0]["caption"].split("rooted on ")[1].split(",")[0] if rows else None,
        })
        print(f"[{n}/{len(by_sha)}] {splits[sha]:5s} {len(rows):3d} clips  {path.name[:60]}",
              flush=True)

    with open(CAPTIONS, "w") as f:
        for row in all_rows:
            f.write(json.dumps(row) + "\n")

    counts = {s: sum(1 for r in all_rows if r["split"] == s) for s in ("train", "val", "test")}
    card = {
        "source": "privately shared oud-led qaraami collection (performers unlisted)",
        "songs": len(by_sha),
        "clips": counts,
        "clip_seconds": CLIP_S,
        "sample_rate": SR,
        "loudness_lufs": TARGET_LUFS,
        "caption_template": build_caption(100, "A"),
        "songs_detail": per_song,
    }
    CARD.write_text(json.dumps(card, indent=2))
    print(json.dumps({"songs": len(by_sha), "clips": counts}, indent=2), flush=True)


if __name__ == "__main__":
    sys.exit(main())
