"""Phase 0 corpus audit: build data/manifest.csv from the audio actually on this machine.

Every field is measured (ffprobe headers, full ffmpeg decode for RMS/clipping,
sha256 of file bytes) or joined from the Harvard catalog / repo inventory CSVs.
Nothing is estimated.

Usage: python3 scripts/build_manifest.py  (from apps/ai-service)
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

HOME = Path.home()
REPO = Path(__file__).resolve().parents[3]

SOURCE_DIRS = [
    (HOME / "Downloads/01_raw_mp3", "Harvard AWM (Spec Coll 103)"),
    (HOME / "Downloads/01_raw_mp3 2", "Harvard AWM (Spec Coll 103)"),
    (HOME / "Downloads/raw", "Harvard AWM (Spec Coll 103) — WAV conversion"),
]
CATALOG_CSV = HOME / "Downloads/harvard_tracks_metadata.csv"
INVENTORY_CSV = REPO / "data/harvard_inventory.csv"
OUT_CSV = REPO / "data/manifest.csv"

AUDIO_EXT = {".wav", ".mp3", ".flac"}
GENRES = ["dhaanto", "buraanbur", "heello", "shanto", "balwo", "qaraami"]
CLIP_THRESH = 0.999  # |sample| at/above this counts as clipped
SILENT_DBFS = -45.0  # whole-file RMS below this flags the file as silent/dead
DATE_RE = re.compile(r"(19\d{2})(?:-(\d{2})-(\d{2}))?")
TRACK_RE = re.compile(r"track_(\d{4})")


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0",
         "-show_entries", "stream=sample_rate,channels,bits_per_sample,bits_per_raw_sample",
         "-show_entries", "format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    info = json.loads(out.stdout)
    stream = info["streams"][0]
    bits = stream.get("bits_per_sample") or stream.get("bits_per_raw_sample") or 0
    return {
        "duration_s": round(float(info["format"]["duration"]), 2),
        "sample_rate": int(stream["sample_rate"]),
        "channels": int(stream["channels"]),
        "bit_depth": int(bits) if int(bits) else "",  # MP3 has no bit depth
    }


def measure_audio(path: Path) -> dict:
    """Decode the whole file to float32 via ffmpeg; return RMS dBFS + clipping %."""
    proc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-"],
        stdout=subprocess.PIPE,
    )
    sum_sq = 0.0
    n = 0
    clipped = 0
    while True:
        buf = proc.stdout.read(1 << 22)
        if not buf:
            break
        x = np.frombuffer(buf, dtype=np.float32)
        sum_sq += float(np.sum(x.astype(np.float64) ** 2))
        clipped += int(np.count_nonzero(np.abs(x) >= CLIP_THRESH))
        n += x.size
    proc.wait()
    if proc.returncode != 0 or n == 0:
        return {"rms_dbfs": "", "clipping_pct": "", "decode_error": True}
    rms = np.sqrt(sum_sq / n)
    rms_dbfs = 20 * np.log10(rms) if rms > 0 else -120.0
    return {
        "rms_dbfs": round(float(rms_dbfs), 2),
        "clipping_pct": round(100.0 * clipped / n, 4),
        "decode_error": False,
    }


def load_metadata() -> tuple[dict, dict]:
    catalog = {}
    with open(CATALOG_CSV, newline="") as f:
        for i, row in enumerate(csv.DictReader(f), start=1):
            catalog[i] = row
    inventory = {}
    if INVENTORY_CSV.exists():
        with open(INVENTORY_CSV, newline="") as f:
            for row in csv.DictReader(f):
                inventory[row["filename"]] = row
    return catalog, inventory


def metadata_for(path: Path, catalog: dict, inventory: dict) -> dict:
    title = artist = year = genre = ""
    inv = inventory.get(path.name)
    m = TRACK_RE.search(path.name)
    cat = catalog.get(int(m.group(1))) if m else None
    if inv:
        title = inv.get("title", "")
        artist = inv.get("artists", "")
        year = inv.get("recorded_year", "")
    elif cat:
        title = cat.get("title", "")
    if not year:
        source_text = f"{title} {path.name} {(cat or {}).get('title', '')}"
        dm = DATE_RE.search(source_text)
        if dm:
            year = dm.group(1)
    hay = f"{title} {path.name}".lower()
    hits = [g for g in GENRES if g in hay]
    if len(hits) == 1:
        genre = hits[0].capitalize()
    return {"title": title, "artist": artist, "year": year, "genre": genre}


def process_file(path: Path, provenance: str, catalog: dict, inventory: dict) -> dict:
    row = {"file_path": str(path), "provenance": provenance, "license_status": "unknown"}
    if path.stem.startswith("somali_test"):
        row["provenance"] = "other (test file, not an AWM track)"
    row["sha256"] = sha256_of(path)
    try:
        row.update(probe(path))
    except (subprocess.CalledProcessError, KeyError, IndexError, json.JSONDecodeError):
        row.update({"duration_s": "", "sample_rate": "", "channels": "", "bit_depth": ""})
    row.update(measure_audio(path))
    row.update(metadata_for(path, catalog, inventory))
    return row


def main() -> None:
    catalog, inventory = load_metadata()
    files = []
    for d, prov in SOURCE_DIRS:
        if not d.is_dir():
            print(f"MISSING DIR: {d}", file=sys.stderr)
            continue
        files += [(p, prov) for p in sorted(d.iterdir()) if p.suffix.lower() in AUDIO_EXT]
    print(f"Processing {len(files)} files...")

    with ThreadPoolExecutor(max_workers=5) as ex:
        rows = list(ex.map(lambda a: process_file(a[0], a[1], catalog, inventory), files))

    cols = ["file_path", "sha256", "duration_s", "sample_rate", "channels", "bit_depth",
            "rms_dbfs", "clipping_pct", "provenance", "license_status",
            "title", "artist", "year", "genre"]
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_CSV, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    print(f"Wrote {OUT_CSV} ({len(rows)} rows)")

    # ---- Summary (measured) ----
    ok = [r for r in rows if not r.get("decode_error")]
    durs = [r["duration_s"] for r in ok if r["duration_s"] != ""]
    total_h = sum(durs) / 3600
    by_sha = {}
    for r in rows:
        by_sha.setdefault(r["sha256"], []).append(r["file_path"])
    dup_groups = {k: v for k, v in by_sha.items() if len(v) > 1}
    track_ids = [TRACK_RE.search(Path(r["file_path"]).name).group(1)
                 for r in rows if TRACK_RE.search(Path(r["file_path"]).name)]
    dup_tracks = {t for t in track_ids if track_ids.count(t) > 1}

    def dist(key):
        d = {}
        for r in ok:
            d[r[key]] = d.get(r[key], 0) + 1
        return d

    summary = {
        "file_count": len(rows),
        "decode_errors": len(rows) - len(ok),
        "total_hours": round(total_h, 2),
        "exact_dup_sha256_groups": len(dup_groups),
        "exact_dup_extra_files": sum(len(v) - 1 for v in dup_groups.values()),
        "same_track_id_in_two_formats": sorted(dup_tracks),
        "sample_rate_dist": dist("sample_rate"),
        "channel_dist": dist("channels"),
        "with_title": sum(1 for r in rows if r["title"]),
        "with_artist": sum(1 for r in rows if r["artist"]),
        "with_year": sum(1 for r in rows if r["year"]),
        "with_genre_from_metadata": sum(1 for r in rows if r["genre"]),
        "silent_files_rms_below_-45dBFS": [r["file_path"] for r in ok
                                           if r["rms_dbfs"] != "" and r["rms_dbfs"] < SILENT_DBFS],
        "clipped_over_5pct": [r["file_path"] for r in ok
                              if r["clipping_pct"] != "" and r["clipping_pct"] > 5.0],
        "under_30s": [r["file_path"] for r in ok if r["duration_s"] != "" and r["duration_s"] < 30],
        "license_status_breakdown": dist("license_status"),
    }
    print(json.dumps(summary, indent=2))
    if dup_groups:
        print("\nExact duplicate groups (sha256):")
        for v in dup_groups.values():
            print("  " + " == ".join(v))


if __name__ == "__main__":
    main()
