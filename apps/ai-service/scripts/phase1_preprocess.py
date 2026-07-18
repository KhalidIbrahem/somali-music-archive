"""Phase 1: preprocess the audited local Harvard corpus for MusicGen fine-tuning.

Reads data/manifest.csv (Phase 0 output). For each unique AWM track:
  decode -> 32 kHz mono -> peak norm -> -14 LUFS -> 15 s / 50% overlap segments
  (dropping segments >20 dB below the file's median segment RMS) -> 16-bit WAVs
  under data/clips/<split>/, plus one caption per clip in data/captions.jsonl.

Song-level 80/10/10 split assigned by sorted sha256 — no song in two splits.
All caption numbers are measured (librosa tempo, pentatonic tonic detection);
genre comes from metadata only, never guessed from audio.

Usage: python3 scripts/phase1_preprocess.py  (from apps/ai-service)
"""

from __future__ import annotations

import csv
import json
import re
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf

from scripts.pentatonic import detect_from_audio

REPO = Path(__file__).resolve().parents[3]
MANIFEST = REPO / "data/manifest.csv"
CLIPS_DIR = REPO / "data/clips"
CAPTIONS = REPO / "data/captions.jsonl"
SPLITS = REPO / "data/splits.json"

SR = 32000
CLIP_S = 15.0
WIN = int(CLIP_S * SR)
HOP = WIN // 2
PEAK = 0.99
TARGET_LUFS = -14.0
QUIET_DROP_DB = 20.0
TRACK_RE = re.compile(r"track_(\d{4})")


def decode_32k_mono(path: str) -> np.ndarray:
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
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


def build_caption(genre: str, bpm: float, tonic: str, year: str) -> str:
    parts = [f"{genre}, traditional Somali music" if genre else "traditional Somali song"]
    parts.append(f"{tempo_word(bpm)} at {round(bpm)} BPM")
    parts.append(f"pentatonic melody rooted on {tonic}")
    era = f"{year[:3]}0s" if year else "vintage"
    parts.append(f"{era} archival recording")
    return ", ".join(parts)


def process_track(track: dict) -> dict:
    y = decode_32k_mono(track["file_path"])
    y *= PEAK / max(np.abs(y).max(), 1e-9)
    loudness = pyln.Meter(SR).integrated_loudness(y.astype(np.float64))
    y = y * (10.0 ** ((TARGET_LUFS - loudness) / 20.0))
    limited = False
    peak = np.abs(y).max()
    if peak > PEAK:
        y *= PEAK / peak
        limited = True
    y = y.astype(np.float32)

    tonic = detect_from_audio(y, SR)

    starts = range(0, len(y) - WIN + 1, HOP)
    rms_db = np.array([
        20 * np.log10(np.sqrt(np.mean(y[s:s + WIN] ** 2)) + 1e-12) for s in starts
    ])
    keep_mask = rms_db >= (np.median(rms_db) - QUIET_DROP_DB)

    out_dir = CLIPS_DIR / track["split"]
    out_dir.mkdir(parents=True, exist_ok=True)
    sha8 = track["sha256"][:8]
    rows = []
    for i, (s, keep) in enumerate(zip(starts, keep_mask)):
        if not keep:
            continue
        clip = y[s:s + WIN]
        clip_path = out_dir / f"{sha8}_seg{i:03d}.wav"
        sf.write(clip_path, clip, SR, subtype="PCM_16")
        caption = build_caption(track["genre"], tempo_bpm(clip),
                                tonic["tonic_name"], track["year"])
        rows.append({
            "clip_path": str(clip_path.relative_to(REPO)),
            "caption": caption,
            "song_sha256": track["sha256"],
            "split": track["split"],
        })
    return {
        "track_id": track["track_id"],
        "sha256": track["sha256"],
        "split": track["split"],
        "tonic": tonic["tonic_name"],
        "mode": tonic["mode"],
        "tonic_score": round(tonic["score"], 3),
        "loudness_limited": limited,
        "segments_total": len(rms_db),
        "segments_kept": len(rows),
        "rows": rows,
    }


def load_tracks() -> list[dict]:
    with open(MANIFEST, newline="") as f:
        manifest = list(csv.DictReader(f))
    by_id: dict[str, dict] = {}
    for r in manifest:
        m = TRACK_RE.search(Path(r["file_path"]).name)
        if not m:  # somali_test_001 — not an AWM track, excluded
            continue
        tid = m.group(1)
        # prefer the MP3 (original download) when both formats exist
        if tid not in by_id or r["file_path"].endswith(".mp3"):
            by_id[tid] = r
    tracks = [
        {"track_id": tid, "file_path": r["file_path"], "sha256": r["sha256"],
         "genre": r["genre"], "year": r["year"]}
        for tid, r in sorted(by_id.items())
    ]
    tracks.sort(key=lambda t: t["sha256"])
    n = len(tracks)
    n_train = round(n * 0.8)
    n_val = round(n * 0.1)
    for i, t in enumerate(tracks):
        t["split"] = "train" if i < n_train else ("val" if i < n_train + n_val else "test")
    return tracks


def main() -> None:
    tracks = load_tracks()
    counts = {s: sum(1 for t in tracks if t["split"] == s) for s in ("train", "val", "test")}
    print(f"{len(tracks)} unique tracks -> splits {counts}", flush=True)

    results = []
    with ProcessPoolExecutor(max_workers=3) as ex:
        for i, res in enumerate(ex.map(process_track, tracks), 1):
            results.append(res)
            print(f"[{i}/{len(tracks)}] track_{res['track_id']} split={res['split']} "
                  f"kept {res['segments_kept']}/{res['segments_total']} "
                  f"tonic={res['tonic']} (r={res['tonic_score']})", flush=True)

    with open(CAPTIONS, "w") as f:
        for res in results:
            for row in res["rows"]:
                f.write(json.dumps(row) + "\n")
    with open(SPLITS, "w") as f:
        json.dump([{k: v for k, v in r.items() if k != "rows"} for r in results],
                  f, indent=1)

    clip_counts = {s: sum(r["segments_kept"] for r in results if r["split"] == s)
                   for s in ("train", "val", "test")}
    dropped = sum(r["segments_total"] - r["segments_kept"] for r in results)
    limited = sum(1 for r in results if r["loudness_limited"])
    print(json.dumps({
        "clips_per_split": clip_counts,
        "clips_total": sum(clip_counts.values()),
        "quiet_segments_dropped": dropped,
        "tracks_peak_limited_after_lufs": limited,
    }, indent=2), flush=True)


if __name__ == "__main__":
    sys.exit(main())
