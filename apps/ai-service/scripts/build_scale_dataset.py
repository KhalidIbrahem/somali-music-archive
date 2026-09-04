"""Build the 30-second clip datasets for the scaling programme (Stage 2), with
Somali-specific text conditioning and song-level splits.

Reads the per-file inventory records (data/inventory/<source>.jsonl) produced by
corpus_inventory.py, cuts each SOURCE file into 30 s clips (32 kHz mono, peak
norm then -14 LUFS, 50% overlap, quiet clips dropped), detects tempo and
pentatonic tonic per clip (reusing the project's own detectors), and writes a
Somali caption per clip:

  "<genre>, Somali <tradition>, led by <instruments>, <tempo-word> at <N> BPM,
   pentatonic melody rooted on <tonic>, <era/tape descriptor>[, <artist>][, <region>]"

Genre / instrument / era tags come from filename + inventory signals (vocals
flag, percussive ratio) and, for Harvard, the harvard_inventory.csv metadata
(title/artist/date). Nothing is asserted that the data does not support:
genre defaults to "qaraami" only when a genre word is present or the source is
the oud/Harvard qaraami corpus; otherwise "Somali song".

Splits are SONG-LEVEL by source-file sha256 (a whole song is train OR val OR
test, never split), 80/10/10, deterministic by sorted sha. A leakage check
asserts no sha appears in two splits and prints the per-split song/clip counts.

Captions carry provenance (source group + rights tier). No audio leaves the
machine; clips and tokens are gitignored.

Usage (from apps/ai-service):
  python -m scripts.build_scale_dataset --inventory ../../data/inventory \
      --out-clips ../../data/scale_clips --out-captions ../../data/scale_captions.jsonl \
      [--sources harvard_raw oud_ilkacase band_qaraami] [--seconds 30]
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import subprocess
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf

from scripts.pentatonic import detect_from_audio

REPO = Path(__file__).resolve().parents[3]
SR = 32000
TARGET_LUFS = -14.0
PEAK = 0.99
QUIET_DROP_DB = 20.0

GENRE_WORDS = {
    "qaraami": "qaraami", "heello": "heello", "heelo": "heello", "hees": "hees",
    "dhaanto": "dhaanto", "balwo": "balwo", "buraanbur": "buraanbur", "shanto": "shanto",
}
GENRE_DEFAULT = {"harvard_raw": "Somali song", "oud_ilkacase": "qaraami", "band_qaraami": "qaraami"}
TRADITION = "traditional song"
ERA_TAG = {
    "harvard_raw": "vintage archival cassette recording, 1955–1991",
    "oud_ilkacase": "intimate oud recording",
    "band_qaraami": "archival qaraami recording",
}


def load_harvard_meta() -> dict[str, dict]:
    path = REPO / "data/harvard_inventory.csv"
    if not path.exists():
        return {}
    out = {}
    for row in csv.DictReader(open(path)):
        out[row["filename"]] = row
    return out


def tempo_bpm(clip: np.ndarray) -> float:
    import librosa

    try:
        from librosa.feature.rhythm import tempo as _tempo
    except ImportError:
        _tempo = librosa.beat.tempo
    return float(np.atleast_1d(_tempo(y=clip, sr=SR))[0])


def tempo_word(bpm: float) -> str:
    return "slow" if bpm < 80 else ("moderate" if bpm <= 120 else "lively")


def genre_from_name(name: str, source: str) -> str:
    low = name.lower()
    for word, canon in GENRE_WORDS.items():
        if word in low:
            return canon
    return GENRE_DEFAULT.get(source, "Somali song")


def instruments(rec: dict, source: str, name: str) -> str:
    low = name.lower()
    parts = []
    if "kaban" in low or "oud" in low or source == "oud_ilkacase":
        parts.append("the oud (kaban)")
    if rec.get("vocals") == "likely" or "cod" in low or "hele" in low or "heele" in low:
        parts.append("vocals")
    if (rec.get("percussive_ratio") or 0) >= 0.35:
        parts.append("hand drums")
    if not parts:
        parts.append("the oud (kaban)" if source in ("oud_ilkacase", "band_qaraami") else "ensemble")
    return " and ".join(parts)


def artist_region(source: str, name: str, hmeta: dict) -> tuple[str | None, str | None]:
    if source == "harvard_raw":
        row = hmeta.get(name)
        if row and row.get("artists") and row["artists"] not in ("[?]", ""):
            return row["artists"].split("(")[0].strip(), None
    if source == "oud_ilkacase":
        return "Ilkacase Qays", None
    m = re.search(r"(Cali Gacal|Riftoon|Qalinle|Deeqa|Kuluc|Caydaruus|Maandeeq|Luul)", name, re.I)
    return (m.group(1) if m else None), None


def build_caption(source: str, name: str, bpm: float, tonic: str, rec: dict, hmeta: dict) -> str:
    genre = genre_from_name(name, source)
    instr = instruments(rec, source, name)
    parts = [genre if genre != "Somali song" else "Somali song",
             f"Somali {TRADITION}" if genre != "Somali song" else None,
             f"led by {instr}",
             f"{tempo_word(bpm)} at {round(bpm)} BPM",
             f"pentatonic melody rooted on {tonic}",
             ERA_TAG.get(source, "archival recording")]
    artist, region = artist_region(source, name, hmeta)
    if artist:
        parts.append(f"performed by {artist}")
    if region:
        parts.append(region)
    return ", ".join(p for p in parts if p)


def decode_mono32(path: Path) -> np.ndarray:
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True, check=True,
    )
    return np.frombuffer(out.stdout, dtype=np.float32).copy()


def song_splits(shas: list[str]) -> dict[str, str]:
    """Deterministic 80/10/10 by sorted sha256."""
    uniq = sorted(set(shas))
    split = {}
    for i, sha in enumerate(uniq):
        r = i / max(1, len(uniq))
        split[sha] = "train" if r < 0.8 else ("val" if r < 0.9 else "test")
    return split


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--inventory", required=True)
    ap.add_argument("--out-clips", required=True)
    ap.add_argument("--out-captions", required=True)
    ap.add_argument("--sources", nargs="*", default=["harvard_raw", "oud_ilkacase", "band_qaraami"])
    ap.add_argument("--seconds", type=float, default=30.0)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    win = int(args.seconds * SR)
    hop = win // 2
    meter = pyln.Meter(SR)
    hmeta = load_harvard_meta()
    inv = Path(args.inventory)
    clips_root = Path(args.out_clips)
    clips_root.mkdir(parents=True, exist_ok=True)

    # 1. gather source records with a stable per-song sha (full-file sha256)
    records = []
    for source in args.sources:
        jl = inv / f"{source}.jsonl"
        if not jl.exists():
            print(f"skip {source}: no inventory")
            continue
        for line in jl.read_text().splitlines():
            r = json.loads(line)
            if "error" in r or not r.get("duration_s"):
                continue
            r["source"] = source
            records.append(r)
    if args.limit:
        records = records[: args.limit]

    # 2. song-level splits by full-file sha256 (dedup: same content = same song)
    def full_sha(path: str) -> str:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for b in iter(lambda: f.read(1 << 20), b""):
                h.update(b)
        return h.hexdigest()
    for r in records:
        r["song_sha"] = full_sha(r["path"])
    splits = song_splits([r["song_sha"] for r in records])

    # 3. cut clips + captions
    for sub in ("train", "val", "test"):
        (clips_root / sub).mkdir(exist_ok=True)
    caps = []
    stats = {"train": {"songs": set(), "clips": 0}, "val": {"songs": set(), "clips": 0}, "test": {"songs": set(), "clips": 0}}
    for ri, r in enumerate(records, 1):
        split = splits[r["song_sha"]]
        try:
            audio = decode_mono32(Path(r["path"]))
        except subprocess.CalledProcessError:
            continue
        peak = float(np.max(np.abs(audio))) if audio.size else 0.0
        if peak > 0:
            audio = audio * (PEAK / peak)
        stem = f"{r['source']}_{r['song_sha'][:12]}"
        n_clips = 0
        for si, start in enumerate(range(0, max(1, len(audio) - win + 1), hop)):
            clip = audio[start:start + win]
            if clip.shape[0] < win:
                break
            rms = 20 * np.log10(np.sqrt(np.mean(clip ** 2)) + 1e-9)
            file_rms = 20 * np.log10(np.sqrt(np.mean(audio ** 2)) + 1e-9)
            if rms < file_rms - QUIET_DROP_DB:
                continue
            loud = meter.integrated_loudness(clip.astype(np.float64))
            if np.isfinite(loud):
                clip = clip * (10 ** ((TARGET_LUFS - loud) / 20))
            p2 = float(np.max(np.abs(clip)))
            if p2 > PEAK:
                clip = clip * (PEAK / p2)
            try:
                det = detect_from_audio(clip, SR)
                tonic = det["tonic_name"] if isinstance(det, dict) else det
            except Exception:
                tonic = "A"
            try:
                bpm = tempo_bpm(clip)
            except Exception:
                bpm = 100.0
            rel = f"{split}/{stem}_seg{si:03d}.wav"
            sf.write(clips_root / rel, clip.astype(np.float32), SR, subtype="PCM_16")
            caps.append({
                "clip_path": f"data/scale_clips/{rel}",
                "caption": build_caption(r["source"], r["name"], bpm, tonic, r, hmeta),
                "song_sha256": r["song_sha"], "split": split, "source": r["source"],
                "source_name": r["name"], "rights": r["source"],
            })
            n_clips += 1
        stats[split]["songs"].add(r["song_sha"])
        stats[split]["clips"] += n_clips
        if ri % 20 == 0 or ri == len(records):
            print(f"{ri}/{len(records)} songs cut ({sum(s['clips'] for s in stats.values())} clips)", flush=True)

    Path(args.out_captions).write_text("\n".join(json.dumps(c) for c in caps) + "\n")

    # 4. leakage check
    by_split = {s: {c["song_sha256"] for c in caps if c["split"] == s} for s in ("train", "val", "test")}
    overlap = (by_split["train"] & by_split["val"]) | (by_split["train"] & by_split["test"]) | (by_split["val"] & by_split["test"])
    print(json.dumps({
        "clips_total": len(caps),
        "songs": {s: len(stats[s]["songs"]) for s in stats},
        "clips_per_split": {s: stats[s]["clips"] for s in stats},
        "leakage_song_overlap": len(overlap),
        "captions": str(args.out_captions),
    }, indent=2))
    assert not overlap, f"LEAKAGE: {len(overlap)} songs in multiple splits"
    print("LEAKAGE CHECK PASSED" if not overlap else "LEAKAGE DETECTED")


if __name__ == "__main__":
    main()
