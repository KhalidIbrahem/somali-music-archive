"""Local processing pipeline for the Harvard Maryan "Aryette" Omar Ali collection.

Runs the full Phase A–D (+ F) research pipeline on a local machine (Apple
Silicon M-series), mirroring `notebooks/harvard_pipeline.ipynb` (the Colab
variant) stage for stage:

    inventory   Phase A — discover audio, parse filenames, cross-reference the
                Harvard HOLLIS catalog CSV, flag duplicates → harvard_inventory.csv
    quality     Phase B1 — per-file audio audit (SNR, clipping, silence)
    clean       Phase B2 — DeepFilterNet noise removal
    separate    Phase B3 — Demucs htdemucs_ft → vocals / no_vocals
    normalize   Phase B4 — -23 LUFS + 80 Hz high-pass (cassette rumble)
    transcribe  Phase C  — Whisper large-v3 Somali transcription + translation
    pitch       Phase D  — CREPE f0 → Somali scale map, ornaments, per-track stats
    embed       Phase F  — MERT-v1-95M 768-d embeddings
    assemble    Phase G  — merge everything into the master dataset record

Design rules (non-negotiable, from the session spec):
  * RESUMABLE — every stage skips work whose output already exists and
    checkpoints progress to disk, so a crash or Ctrl-C loses at most one track.
  * LOCAL — audio never leaves this machine; Whisper/CREPE/MERT run locally.
  * LAZY IMPORTS — heavy ML deps are imported inside the stage that needs
    them, so `inventory`/`quality` run on a bare pandas+numpy+ffmpeg machine
    and a missing dep fails with an actionable message, not an ImportError
    at startup.
  * CORRELATED LOGS — every log line carries the track_id it concerns.

Usage:
    cd apps/ai-service
    python -m scripts.process_harvard inventory
    python -m scripts.process_harvard quality
    python -m scripts.process_harvard all          # every stage, in order
    python -m scripts.process_harvard pitch --limit 5   # smoke-run

Paths default to the repo's `data/` tree and the known local corpus copies,
overridable via CLI flags or the SOMALI_* environment variables — no
hardcoded user-specific paths inside stage logic.
"""

from __future__ import annotations

import argparse
import dataclasses
import gc
import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import sys
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Make `utils.` / `services.` importable when run as a plain script from
# anywhere (python scripts/process_harvard.py) as well as with -m.
_SERVICE_ROOT = Path(__file__).resolve().parent.parent
if str(_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(_SERVICE_ROOT))

import numpy as np

from utils.scale_mapping import SOMALI_SCALE_HZ, map_pitch_frames  # noqa: E402

# ---------------------------------------------------------------------------
# Constants — analysis thresholds (single place to tune, cited in the paper)
# ---------------------------------------------------------------------------

AUDIO_EXTENSIONS = (".wav", ".mp3", ".flac")
TARGET_LUFS = -23.0  # EBU R128 broadcast loudness target
HIGHPASS_HZ = 80  # cassette-motor rumble cutoff
SNR_FLAG_THRESHOLD_DB = 15.0  # below this the track is flagged, not dropped
CLIPPING_SAMPLE_FRACTION = 1e-4  # >0.01% full-scale samples counts as clipped
SILENCE_FLOOR_DBFS = -50.0  # frame RMS below this is "silence" for trimming
PITCH_CONFIDENCE_THRESHOLD = 0.80
PITCH_STEP_MS = 10

# Ornament classification (Phase D3). All values in cents / seconds.
GRACE_NOTE_MAX_SEC = 0.05
GLISSANDO_MIN_SEC = 0.20
GLISSANDO_MIN_NET_CENTS = 80.0  # net slide approaching a neighbouring degree
VIBRATO_RATE_HZ = (4.0, 8.0)
VIBRATO_MIN_PEAK_CENTS = 30.0
STRAIGHT_MAX_RANGE_CENTS = 20.0
NOTE_EVENT_MAX_GAP_SEC = 0.05  # tolerate a few dropped frames inside one note

CHECKPOINT_EVERY_N_TRACKS = 10

log = logging.getLogger("harvard_pipeline")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PipelineConfig:
    """All filesystem locations the pipeline reads or writes.

    Defaults resolve relative to the repository root so no stage ever
    hardcodes a user path; everything is overridable for Colab/CI via
    environment variables (SOMALI_DATA_ROOT, SOMALI_AUDIO_DIRS,
    SOMALI_CATALOG_CSV) or CLI flags.
    """

    data_root: Path
    audio_dirs: tuple[Path, ...]
    catalog_csv: Path | None

    @property
    def inventory_csv(self) -> Path:
        return self.data_root / "harvard_inventory.csv"

    @property
    def quality_dir(self) -> Path:
        return self.data_root / "reports" / "quality"

    @property
    def cleaned_dir(self) -> Path:
        return self.data_root / "02_cleaned"

    @property
    def separated_dir(self) -> Path:
        return self.data_root / "03_separated"

    @property
    def normalized_dir(self) -> Path:
        return self.data_root / "04_normalized"

    @property
    def transcripts_dir(self) -> Path:
        return self.data_root / "transcripts"

    @property
    def pitch_dir(self) -> Path:
        return self.data_root / "pitch_data"

    @property
    def embeddings_dir(self) -> Path:
        return self.data_root / "embeddings"

    @property
    def dataset_dir(self) -> Path:
        return self.data_root / "dataset"

    @property
    def progress_json(self) -> Path:
        return self.data_root / "progress.json"


def default_config(repo_root: Path | None = None) -> PipelineConfig:
    """Build the default config from the repo layout + environment overrides.

    Why env-var override instead of a config file: the same script must run on
    a laptop (Downloads corpus), an external drive, and Colab (Drive mount)
    without editing source — the spec's "no hardcoded paths" rule.
    """
    root = repo_root or _SERVICE_ROOT.parent.parent
    data_root = Path(os.environ.get("SOMALI_DATA_ROOT", str(root / "data")))

    if env_dirs := os.environ.get("SOMALI_AUDIO_DIRS"):
        audio_dirs = tuple(Path(p).expanduser() for p in env_dirs.split(":") if p)
    else:
        home = Path.home()
        candidates = (
            data_root / "harvard_audio",
            data_root / "01_raw",
            home / "Downloads" / "01_raw_mp3",
            home / "Downloads" / "01_raw_mp3 2",
        )
        audio_dirs = tuple(p for p in candidates if p.is_dir())

    catalog_env = os.environ.get("SOMALI_CATALOG_CSV")
    if catalog_env:
        catalog: Path | None = Path(catalog_env).expanduser()
    else:
        found = next(
            (
                p
                for p in (
                    data_root / "harvard_tracks_metadata.csv",
                    Path.home() / "Downloads" / "harvard_tracks_metadata.csv",
                )
                if p.is_file()
            ),
            None,
        )
        catalog = found
    return PipelineConfig(data_root=data_root, audio_dirs=audio_dirs, catalog_csv=catalog)


# ---------------------------------------------------------------------------
# Logging with track_id correlation
# ---------------------------------------------------------------------------


class _TrackFilter(logging.Filter):
    """Guarantees every record has a track_id field so the format never breaks."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "track_id"):
            record.track_id = "-"
        return True


def setup_logging(verbose: bool = False) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)-7s [%(track_id)s] %(message)s")
    )
    handler.addFilter(_TrackFilter())
    log.addHandler(handler)
    log.setLevel(logging.DEBUG if verbose else logging.INFO)


def tlog(track_id: str, message: str, level: int = logging.INFO) -> None:
    """Log with the track correlation id every pipeline line must carry."""
    log.log(level, message, extra={"track_id": track_id})


# ---------------------------------------------------------------------------
# Checkpointing (resumability)
# ---------------------------------------------------------------------------


@dataclass
class Progress:
    """Per-stage progress ledger persisted to progress.json.

    Kept as three explicit lists (not a single status map) because the spec's
    resumability contract is expressed that way and it diffs legibly in git.
    """

    completed: list[str] = field(default_factory=list)
    failed: dict[str, str] = field(default_factory=dict)
    pending: list[str] = field(default_factory=list)


def load_progress(path: Path) -> dict[str, Progress]:
    """Load the progress ledger, tolerating a missing or corrupt file.

    A corrupt checkpoint must never brick the pipeline — the outputs on disk
    are the real source of truth; the ledger is a convenience view of them.
    """
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("progress.json unreadable (%s) — starting a fresh ledger", exc)
        return {}
    return {
        stage: Progress(
            completed=list(entry.get("completed", [])),
            failed=dict(entry.get("failed", {})),
            pending=list(entry.get("pending", [])),
        )
        for stage, entry in raw.items()
    }


def save_progress(path: Path, ledger: dict[str, Progress]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    serializable = {stage: dataclasses.asdict(p) for stage, p in ledger.items()}
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(serializable, indent=2))
    tmp.replace(path)  # atomic — a crash mid-write can't corrupt the ledger


# ---------------------------------------------------------------------------
# Phase A — inventory helpers (pure, unit-tested)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ParsedTrack:
    """Structured fields recovered from a `track_XXXX_<slug>` filename."""

    track_id: str  # canonical id, e.g. "track_0005"
    index: int  # 5
    slug: str  # human-readable remainder of the filename
    side: str | None  # "A" / "B" when the slug encodes it
    track_on_side: int | None


_FILENAME_RE = re.compile(r"^track_(\d{4})_(.+)$")
_SIDE_RE = re.compile(r"^Side_([AB])_Track_(\d+)_?(.*)$", re.IGNORECASE)
_CATALOG_SIDE_RE = re.compile(r"^Side\s+([AB])\.?\s*Track\s+(\d+):?\s*(.*)$", re.IGNORECASE)
_ARTIST_SONGS_BY_RE = re.compile(r"^Songs\s+by\s+(.+)$", re.IGNORECASE)
# Many HOLLIS titles embed the recording date: "Milgo, 1966-08-25" or ", 1974".
_TRAILING_DATE_RE = re.compile(r",\s*((19\d{2})(?:-\d{2}-\d{2})?)\s*$")


def extract_recording_date(text: str | None) -> tuple[str | None, int | None]:
    """Pull a trailing recording date out of a catalog title, when present.

    The Maryan Omar Ali catalog embeds session dates in many titles
    ("Milgo, 1966-08-25", "Soo Hor Caashaqa, 1974"). These per-track dates
    are what makes the early-vs-late tuning-drift analysis (Phase D5)
    possible, so they are promoted to first-class inventory columns.

    Returns:
        (date_string, year) — e.g. ("1966-08-25", 1966) or ("1974", 1974);
        (None, None) when the title carries no date.
    """
    if not text:
        return None, None
    match = _TRAILING_DATE_RE.search(text)
    if not match:
        return None, None
    return match.group(1), int(match.group(2))


def parse_track_filename(filename: str) -> ParsedTrack | None:
    """Parse `track_0005_Side_B_Track_1_Balanbaallis.mp3` into structured fields.

    Returns None for non-corpus files (e.g. somali_test_001.wav) so callers
    can flag rather than crash on strays — archives always contain strays.
    """
    stem = Path(filename).stem
    match = _FILENAME_RE.match(stem)
    if not match:
        return None
    index = int(match.group(1))
    slug = match.group(2)
    side_match = _SIDE_RE.match(slug)
    side: str | None = None
    track_on_side: int | None = None
    if side_match:
        side = side_match.group(1).upper()
        track_on_side = int(side_match.group(2))
    return ParsedTrack(
        track_id=f"track_{index:04d}",
        index=index,
        slug=slug,
        side=side,
        track_on_side=track_on_side,
    )


def parse_catalog_title(title: str) -> dict[str, Any]:
    """Extract side/track/artist hints from a HOLLIS catalog title string.

    The catalog interleaves cassette-level rows ("Sahro Axmed … and others",
    "Songs by Xasan Aadan Samatar") with per-track rows ("Side A. Track 1:
    Wisiisi (Longing)"). Cassette rows carry the artist; track rows carry the
    side/number and song title. Downstream, tracks inherit the artist of the
    most recent cassette row above them.
    """
    title = title.strip()
    side_match = _CATALOG_SIDE_RE.match(title)
    if side_match:
        return {
            "kind": "track",
            "side": side_match.group(1).upper(),
            "track_on_side": int(side_match.group(2)),
            "song_title": side_match.group(3).strip() or None,
            "artists": None,
        }
    by_match = _ARTIST_SONGS_BY_RE.match(title)
    if by_match:
        return {
            "kind": "cassette",
            "side": None,
            "track_on_side": None,
            "song_title": None,
            "artists": by_match.group(1).strip(),
        }
    return {
        "kind": "cassette",
        "side": None,
        "track_on_side": None,
        "song_title": title,
        "artists": title.removesuffix("and others").strip(" ,") or None,
    }


def sha1_of_file(path: Path, chunk_bytes: int = 1 << 20) -> str:
    """Content hash for duplicate detection across corpus copies.

    sha1 (not md5) to match git's identity notion; collisions are irrelevant
    here — we only compare files inside one ~1000-file corpus.
    """
    digest = hashlib.sha1()
    with path.open("rb") as fh:
        while chunk := fh.read(chunk_bytes):
            digest.update(chunk)
    return digest.hexdigest()


def probe_duration_sec(path: Path) -> float | None:
    """Duration via ffprobe — the only decoder we trust for 1970s cassette MP3s.

    libsndfile on this machine has no MPEG support, and mutagen trusts
    (frequently wrong) Xing headers; ffprobe parses the actual stream.
    """
    try:
        out = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "csv=p=0",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=True,
        )
        return round(float(out.stdout.strip()), 2)
    except (subprocess.SubprocessError, ValueError, OSError) as exc:
        tlog(path.stem, f"ffprobe failed: {exc}", logging.WARNING)
        return None


def discover_audio_files(audio_dirs: Sequence[Path]) -> list[Path]:
    """Every audio file under the corpus directories, deterministically ordered."""
    files: list[Path] = []
    for directory in audio_dirs:
        for ext in AUDIO_EXTENSIONS:
            files.extend(directory.rglob(f"*{ext}"))
    return sorted(set(files))


def build_inventory_rows(
    audio_files: Sequence[Path],
    catalog_rows: Sequence[dict[str, str]] | None,
) -> list[dict[str, Any]]:
    """Assemble the Phase A master inventory (one row per discovered file).

    Cross-references the HOLLIS catalog by track index: `track_NNNN` filenames
    were generated from catalog row N by the original download notebook
    (Step0_Download_Harvard_Audio), so row order IS the join key. Cassette
    numbers are synthesized (`cassette_seq`) because the export CSV does not
    carry physical cassette call numbers.
    """
    catalog_by_index: dict[int, dict[str, Any]] = {}
    if catalog_rows:
        cassette_seq = 0
        current_artists: str | None = None
        for i, row in enumerate(catalog_rows, start=1):
            parsed = parse_catalog_title(row.get("title", ""))
            if parsed["kind"] == "cassette":
                cassette_seq += 1
                current_artists = parsed["artists"]
            catalog_by_index[i] = {
                **parsed,
                "catalog_title": row.get("title", "").strip(),
                "artists": parsed["artists"] or current_artists,
                "cassette_seq": cassette_seq,
                "url": row.get("url", ""),
                "date_range": row.get("date", ""),
                "identifier": row.get("identifier", ""),
            }

    rows: list[dict[str, Any]] = []
    seen_hashes: dict[str, str] = {}
    seen_track_ids: dict[str, str] = {}
    for path in audio_files:
        parsed = parse_track_filename(path.name)
        flags: list[str] = []
        if parsed is None:
            flags.append("needs_review:unrecognized_filename")
        digest = sha1_of_file(path)
        if digest in seen_hashes:
            flags.append(f"duplicate_of:{seen_hashes[digest]}")
        else:
            seen_hashes[digest] = path.name
        track_id = parsed.track_id if parsed else Path(path.name).stem
        if track_id in seen_track_ids and "duplicate_of" not in ",".join(flags):
            flags.append(f"same_track_id_as:{seen_track_ids[track_id]}")
        seen_track_ids.setdefault(track_id, path.name)

        cat = catalog_by_index.get(parsed.index) if parsed else None
        duration = probe_duration_sec(path)
        if duration is not None and duration < 10.0:
            flags.append("needs_review:under_10s")
        title = (cat or {}).get("song_title") or (cat or {}).get("catalog_title")
        recorded_date, recorded_year = extract_recording_date(title)
        if recorded_date is None:
            recorded_date, recorded_year = extract_recording_date((cat or {}).get("artists"))
        rows.append(
            {
                "track_id": track_id,
                "filename": path.name,
                "source_dir": str(path.parent),
                "title": title,
                "artists": (cat or {}).get("artists"),
                "recorded_date": recorded_date,
                "recorded_year": recorded_year,
                "duration_sec": duration,
                "format": path.suffix.lstrip(".").lower(),
                "filesize_bytes": path.stat().st_size,
                "side": (parsed.side if parsed else None) or (cat or {}).get("side"),
                "cassette_number": (cat or {}).get("cassette_seq"),
                "harvard_url": (cat or {}).get("url"),
                "sha1": digest,
                "flags": ";".join(flags),
            }
        )
    return rows


# ---------------------------------------------------------------------------
# Audio decoding (shared by quality / pitch / embed stages)
# ---------------------------------------------------------------------------


def load_audio_mono(path: Path, sample_rate: int) -> np.ndarray:
    """Decode any corpus file to mono float32 at `sample_rate` via ffmpeg.

    ffmpeg (not librosa/soundfile) because it is the one decoder guaranteed
    present that reads every format in the corpus, and it resamples in the
    same pass — one subprocess, no temp WAV on disk.

    Raises:
        RuntimeError: if ffmpeg cannot decode the file (corrupt download).
    """
    cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-i",
        str(path),
        "-f",
        "f32le",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, timeout=600)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg decode failed for {path.name}: {proc.stderr.decode()[:400]}")
    return np.frombuffer(proc.stdout, dtype=np.float32)


# ---------------------------------------------------------------------------
# Phase B1 — quality metrics (pure math on arrays, unit-tested)
# ---------------------------------------------------------------------------


def _frame_rms_db(samples: np.ndarray, frame_len: int) -> np.ndarray:
    n_frames = len(samples) // frame_len
    if n_frames == 0:
        return np.array([-120.0])
    frames = samples[: n_frames * frame_len].reshape(n_frames, frame_len)
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))
    return 20.0 * np.log10(np.maximum(rms, 1e-9))


def quality_metrics(samples: np.ndarray, sample_rate: int) -> dict[str, Any]:
    """Phase B1 audit metrics for one decoded track.

    SNR is estimated as loud-frames-over-quiet-frames (90th vs 10th percentile
    of 50 ms frame RMS): on continuous cassette music there is no clean noise
    reference, so tape hiss in the quietest frames is the best available noise
    floor. It is an *estimate* for flagging, not a lab measurement — which is
    why the threshold flags rather than drops.
    """
    if samples.size == 0:
        return {"error": "empty_audio"}
    peak = float(np.max(np.abs(samples)))
    rms = float(np.sqrt(np.mean(samples.astype(np.float64) ** 2)))
    frame_len = max(1, int(sample_rate * 0.050))
    frames_db = _frame_rms_db(samples, frame_len)
    noise_floor_db = float(np.percentile(frames_db, 10))
    signal_db = float(np.percentile(frames_db, 90))
    snr_db = signal_db - noise_floor_db

    clipped_fraction = float(np.mean(np.abs(samples) >= 0.999))
    non_silent = np.where(frames_db > SILENCE_FLOOR_DBFS)[0]
    lead_silence = float(non_silent[0] * frame_len / sample_rate) if non_silent.size else 0.0
    tail_silence = (
        float((len(frames_db) - 1 - non_silent[-1]) * frame_len / sample_rate)
        if non_silent.size
        else 0.0
    )
    return {
        "duration_sec": round(len(samples) / sample_rate, 2),
        "sample_rate": sample_rate,
        "peak_db": round(20.0 * np.log10(max(peak, 1e-9)), 2),
        "rms_db": round(20.0 * np.log10(max(rms, 1e-9)), 2),
        "snr_estimate_db": round(snr_db, 2),
        "clipped_sample_fraction": clipped_fraction,
        "is_clipped": clipped_fraction > CLIPPING_SAMPLE_FRACTION,
        "leading_silence_sec": round(lead_silence, 2),
        "trailing_silence_sec": round(tail_silence, 2),
        "below_snr_threshold": snr_db < SNR_FLAG_THRESHOLD_DB,
    }


# ---------------------------------------------------------------------------
# Phase D3/D4 — note events, ornaments, per-track aggregation (pure)
# ---------------------------------------------------------------------------


@dataclass
class NoteEvent:
    """A maximal run of consecutive pitch frames mapped to one scale degree."""

    note: str
    start_sec: float
    end_sec: float
    cents: list[float]

    @property
    def duration_sec(self) -> float:
        return self.end_sec - self.start_sec


def segment_note_events(points: Sequence[dict[str, Any]]) -> list[NoteEvent]:
    """Group frame-level scale-mapped pitch points into note events.

    A new event starts when the mapped degree changes or the frame gap exceeds
    NOTE_EVENT_MAX_GAP_SEC (i.e. CREPE lost confidence for a few frames —
    common at phrase boundaries and oud plucks).
    """
    events: list[NoteEvent] = []
    current: NoteEvent | None = None
    for pt in points:
        t = float(pt["time_sec"])
        note = str(pt["note_label"])
        cents = float(pt["cents_deviation"])
        if (
            current is None
            or note != current.note
            or t - current.end_sec > NOTE_EVENT_MAX_GAP_SEC
        ):
            if current is not None:
                events.append(current)
            current = NoteEvent(note=note, start_sec=t, end_sec=t, cents=[cents])
        else:
            current.end_sec = t
            current.cents.append(cents)
    if current is not None:
        events.append(current)
    return events


def classify_ornament(event: NoteEvent) -> str:
    """Label one note event as glissando / vibrato / grace_note / straight / other.

    Heuristics follow the session spec thresholds (module constants above).
    Order matters: duration gates first (a 30 ms blip cannot be vibrato no
    matter what its cents do), then trajectory shape.
    """
    duration = event.duration_sec
    cents = np.asarray(event.cents, dtype=np.float64)
    if duration < GRACE_NOTE_MAX_SEC:
        return "grace_note"
    cents_range = float(cents.max() - cents.min()) if cents.size else 0.0
    net_change = float(cents[-1] - cents[0]) if cents.size >= 2 else 0.0

    if duration >= GLISSANDO_MIN_SEC and abs(net_change) >= GLISSANDO_MIN_NET_CENTS:
        return "glissando"

    if cents.size >= 8 and duration > 0:
        detrended = cents - np.linspace(cents[0], cents[-1], cents.size)
        centered = detrended - detrended.mean()
        crossings = int(np.sum(np.signbit(centered[:-1]) != np.signbit(centered[1:])))
        rate_hz = crossings / (2.0 * duration)
        amplitude = float(np.percentile(np.abs(centered), 95))
        if VIBRATO_RATE_HZ[0] <= rate_hz <= VIBRATO_RATE_HZ[1] and (
            amplitude >= VIBRATO_MIN_PEAK_CENTS
        ):
            return "vibrato"

    if cents_range <= STRAIGHT_MAX_RANGE_CENTS:
        return "straight"
    return "other"


def aggregate_track_pitch(points: Sequence[dict[str, Any]]) -> dict[str, Any]:
    """Phase D4 per-track summary from frame-level scale-mapped points.

    Modal center is the duration-weighted dominant degree — the closest
    computable proxy for "which note is home" without a human analyst; the
    ISMIR draft says exactly this and treats it as a proxy, not ground truth.
    """
    events = segment_note_events(points)
    if not events:
        return {
            "n_pitch_points": 0,
            "n_note_events": 0,
            "dominant_notes": [],
            "modal_center": None,
            "melodic_intervals": {},
            "ornaments": {},
            "ornaments_per_minute": {},
            "avg_cents_deviation": {},
            "voiced_seconds": 0.0,
        }

    duration_by_note: Counter[str] = Counter()
    cents_by_note: dict[str, list[float]] = {}
    ornaments: Counter[str] = Counter()
    for ev in events:
        duration_by_note[ev.note] += ev.duration_sec
        cents_by_note.setdefault(ev.note, []).extend(ev.cents)
        ornaments[classify_ornament(ev)] += 1

    intervals: Counter[str] = Counter()
    for prev, nxt in zip(events, events[1:], strict=False):
        if prev.note != nxt.note:
            intervals[f"{prev.note}->{nxt.note}"] += 1

    voiced_seconds = sum(ev.duration_sec for ev in events)
    minutes = max(voiced_seconds / 60.0, 1e-9)
    return {
        "n_pitch_points": len(points),
        "n_note_events": len(events),
        "dominant_notes": [n for n, _ in duration_by_note.most_common(3)],
        "modal_center": duration_by_note.most_common(1)[0][0],
        "melodic_intervals": dict(intervals.most_common(10)),
        "ornaments": dict(ornaments),
        "ornaments_per_minute": {
            k: round(v / minutes, 2) for k, v in ornaments.items()
        },
        "avg_cents_deviation": {
            note: round(float(np.mean(vals)), 2) for note, vals in cents_by_note.items()
        },
        "voiced_seconds": round(voiced_seconds, 2),
    }


# ---------------------------------------------------------------------------
# Stage runners
# ---------------------------------------------------------------------------


def _load_inventory(config: PipelineConfig) -> Any:
    import pandas as pd

    if not config.inventory_csv.is_file():
        raise SystemExit(
            f"{config.inventory_csv} not found — run `process_harvard inventory` first."
        )
    return pd.read_csv(config.inventory_csv)


def _iter_tracks(config: PipelineConfig, limit: int | None) -> list[tuple[str, Path]]:
    """(track_id, source_path) for every non-duplicate inventory row."""
    df = _load_inventory(config)
    out: list[tuple[str, Path]] = []
    for _, row in df.iterrows():
        flags = str(row.get("flags") or "")
        if "duplicate_of" in flags:
            continue
        out.append((str(row["track_id"]), Path(str(row["source_dir"])) / str(row["filename"])))
    return out[:limit] if limit else out


def stage_inventory(config: PipelineConfig, limit: int | None = None) -> Path:
    """Phase A — build data/harvard_inventory.csv from disk + HOLLIS catalog."""
    import csv

    import pandas as pd

    files = discover_audio_files(config.audio_dirs)[: limit or None]
    if not files:
        raise SystemExit(
            f"No audio found under {[str(d) for d in config.audio_dirs]} — "
            "set SOMALI_AUDIO_DIRS or --audio-dir."
        )
    log.info(
        "Phase A: %d audio files across %d dirs; catalog: %s",
        len(files),
        len(config.audio_dirs),
        config.catalog_csv or "NONE (titles/artists will be empty)",
    )
    catalog_rows: list[dict[str, str]] | None = None
    if config.catalog_csv and config.catalog_csv.is_file():
        with config.catalog_csv.open(newline="") as fh:
            catalog_rows = list(csv.DictReader(fh))

    rows = build_inventory_rows(files, catalog_rows)
    df = pd.DataFrame(rows)
    config.data_root.mkdir(parents=True, exist_ok=True)
    df.to_csv(config.inventory_csv, index=False)

    dupes = int(df["flags"].str.contains("duplicate_of").sum())
    total_h = df["duration_sec"].dropna().sum() / 3600.0
    log.info(
        "Inventory saved → %s | %d rows, %d unique tracks, %d duplicates, %.1f h audio",
        config.inventory_csv,
        len(df),
        len(df) - dupes,
        dupes,
        total_h,
    )
    return config.inventory_csv


def _run_per_track_stage(
    stage_name: str,
    config: PipelineConfig,
    limit: int | None,
    output_path_for: Any,
    process_one: Any,
) -> None:
    """Shared resumable loop: skip-if-exists, checkpoint, per-track try/except.

    Every heavy stage has the same shape; centralizing it means the
    resumability contract can't silently regress in one stage.
    """
    from tqdm import tqdm

    tracks = _iter_tracks(config, limit)
    ledger = load_progress(config.progress_json)
    progress = ledger.setdefault(stage_name, Progress())
    progress.pending = [t for t, _ in tracks if t not in progress.completed]

    done_since_save = 0
    for track_id, src in tqdm(tracks, desc=stage_name, unit="track"):
        out_path = output_path_for(track_id)
        if out_path.exists():
            if track_id not in progress.completed:
                progress.completed.append(track_id)
            continue
        if not src.is_file():
            progress.failed[track_id] = "source file missing"
            tlog(track_id, f"source missing: {src}", logging.ERROR)
            continue
        try:
            process_one(track_id, src, out_path)
        except KeyboardInterrupt:
            save_progress(config.progress_json, ledger)
            raise
        except Exception as exc:  # noqa: BLE001 — one bad tape must not kill the run
            progress.failed[track_id] = str(exc)[:500]
            tlog(track_id, f"FAILED: {exc}", logging.ERROR)
            continue
        progress.completed.append(track_id)
        progress.failed.pop(track_id, None)
        if track_id in progress.pending:
            progress.pending.remove(track_id)
        done_since_save += 1
        if done_since_save % CHECKPOINT_EVERY_N_TRACKS == 0:
            save_progress(config.progress_json, ledger)
        if len(progress.completed) % 50 == 0:
            log.info(
                "%s: %d completed, %d failed, %d pending",
                stage_name,
                len(progress.completed),
                len(progress.failed),
                len(progress.pending),
            )
    save_progress(config.progress_json, ledger)
    log.info(
        "%s finished: %d completed, %d failed",
        stage_name,
        len(progress.completed),
        len(progress.failed),
    )


def stage_quality(config: PipelineConfig, limit: int | None = None) -> None:
    """Phase B1 — per-file quality audit → reports/quality/<track>.json."""
    config.quality_dir.mkdir(parents=True, exist_ok=True)

    def process(track_id: str, src: Path, out: Path) -> None:
        samples = load_audio_mono(src, sample_rate=44100)
        metrics = quality_metrics(samples, 44100)
        out.write_text(json.dumps({"track_id": track_id, **metrics}, indent=2))
        if metrics.get("below_snr_threshold"):
            tlog(track_id, f"low SNR: {metrics['snr_estimate_db']} dB", logging.WARNING)

    _run_per_track_stage(
        "quality", config, limit, lambda t: config.quality_dir / f"{t}.json", process
    )


def stage_clean(config: PipelineConfig, limit: int | None = None) -> None:
    """Phase B2 — DeepFilterNet noise removal → 02_cleaned/<track>.wav."""
    try:
        from df.enhance import enhance, init_df, load_audio, save_audio
    except ImportError as exc:
        raise SystemExit("DeepFilterNet not installed: pip install deepfilternet") from exc

    model, df_state, _ = init_df()
    config.cleaned_dir.mkdir(parents=True, exist_ok=True)

    def process(track_id: str, src: Path, out: Path) -> None:
        audio, _ = load_audio(str(src), sr=df_state.sr())
        before = quality_metrics(audio.numpy().flatten(), df_state.sr())
        enhanced = enhance(model, df_state, audio)
        after = quality_metrics(enhanced.numpy().flatten(), df_state.sr())
        save_audio(str(out), enhanced, df_state.sr())
        tlog(
            track_id,
            f"SNR {before.get('snr_estimate_db')} → {after.get('snr_estimate_db')} dB",
        )

    _run_per_track_stage(
        "clean", config, limit, lambda t: config.cleaned_dir / f"{t}.wav", process
    )
    gc.collect()  # model goes out of scope with this frame; collect promptly


def stage_separate(config: PipelineConfig, limit: int | None = None) -> None:
    """Phase B3 — Demucs htdemucs_ft → 03_separated/<track>/{vocals,no_vocals}.wav.

    Shells out to the demucs CLI (rather than its Python API) because the CLI
    owns its own chunking/OOM handling and its two-stem mode writes exactly
    the vocals/no_vocals pair the downstream stages consume.
    """
    if shutil.which("demucs") is None:
        raise SystemExit("Demucs not installed: pip install demucs")
    config.separated_dir.mkdir(parents=True, exist_ok=True)

    def source_for(track_id: str, src: Path) -> Path:
        cleaned = config.cleaned_dir / f"{track_id}.wav"
        return cleaned if cleaned.is_file() else src

    def process(track_id: str, src: Path, out: Path) -> None:
        subprocess.run(
            [
                "demucs",
                "--two-stems",
                "vocals",
                "-n",
                "htdemucs_ft",
                "-o",
                str(config.separated_dir),
                "--filename",
                f"{track_id}/{{stem}}.{{ext}}",
                str(source_for(track_id, src)),
            ],
            check=True,
            timeout=3600,
        )
        produced = config.separated_dir / "htdemucs_ft" / track_id
        if produced.is_dir() and not out.is_dir():
            out.parent.mkdir(parents=True, exist_ok=True)
            produced.rename(out)

    _run_per_track_stage(
        "separate", config, limit, lambda t: config.separated_dir / t, process
    )


def stage_normalize(config: PipelineConfig, limit: int | None = None) -> None:
    """Phase B4 — -23 LUFS loudness + 80 Hz high-pass → 04_normalized/<track>.wav.

    Uses ffmpeg's loudnorm (EBU R128) — the reference implementation — instead
    of hand-rolled gain math.
    """
    config.normalized_dir.mkdir(parents=True, exist_ok=True)

    def source_for(track_id: str, src: Path) -> Path:
        cleaned = config.cleaned_dir / f"{track_id}.wav"
        return cleaned if cleaned.is_file() else src

    def process(track_id: str, src: Path, out: Path) -> None:
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-i",
                str(source_for(track_id, src)),
                "-af",
                f"highpass=f={HIGHPASS_HZ},loudnorm=I={TARGET_LUFS}:TP=-2:LRA=11",
                "-ar",
                "44100",
                str(out),
            ],
            check=True,
            timeout=1800,
        )

    _run_per_track_stage(
        "normalize", config, limit, lambda t: config.normalized_dir / f"{t}.wav", process
    )


def _select_torch_device() -> str:
    import torch

    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def estimate_singing_segments(segments: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], float]:
    """Flag Whisper segments that look sung rather than spoken.

    Whisper exposes no pitch, so this is a text-statistics heuristic: sung
    Somali (melisma, refrains) produces high compression ratios (repetition),
    low avg_logprob (the ASR head is out of distribution), or high
    no_speech_prob (held vowels decode as "not speech"). Segments flagged
    is_singing=True keep their text but must be treated as UNRELIABLE lyrics —
    the corpus stores them for review, never as ground truth.

    Returns (annotated_segments, singing_ratio_by_duration).
    """
    annotated: list[dict[str, Any]] = []
    sung_time = 0.0
    total_time = 0.0
    for seg in segments:
        dur = max(float(seg.get("end", 0.0)) - float(seg.get("start", 0.0)), 0.0)
        is_singing = (
            float(seg.get("compression_ratio", 0.0)) > 2.4
            or float(seg.get("avg_logprob", 0.0)) < -1.0
            or float(seg.get("no_speech_prob", 0.0)) > 0.6
        )
        confidence = float(np.exp(float(seg.get("avg_logprob", -10.0))))
        annotated.append(
            {
                "start": seg.get("start"),
                "end": seg.get("end"),
                "text": (seg.get("text") or "").strip(),
                "confidence": round(confidence, 3),
                "is_singing": is_singing,
            }
        )
        total_time += dur
        if is_singing:
            sung_time += dur
    ratio = round(sung_time / total_time, 3) if total_time > 0 else 0.0
    return annotated, ratio


def stage_transcribe(config: PipelineConfig, limit: int | None = None) -> None:
    """Phase C — Whisper large-v3 transcription + translation of vocal stems."""
    import time

    try:
        import whisper
    except ImportError as exc:
        raise SystemExit("Whisper not installed: pip install openai-whisper") from exc

    device = _select_torch_device()
    # fp16 only helps on GPU; Whisper's MPS path is fastest with fp16 too.
    fp16 = device != "cpu"
    log.info("Loading Whisper large-v3 on %s (fp16=%s)…", device, fp16)
    model = whisper.load_model("large-v3", device=device)
    config.transcripts_dir.mkdir(parents=True, exist_ok=True)

    def source_for(track_id: str, src: Path) -> Path:
        vocals = config.separated_dir / track_id / "vocals.wav"
        return vocals if vocals.is_file() else src

    def process(track_id: str, src: Path, out: Path) -> None:
        audio_path = str(source_for(track_id, src))
        t0 = time.monotonic()
        somali = model.transcribe(
            audio_path, language="so", task="transcribe", word_timestamps=True, fp16=fp16
        )
        english = model.transcribe(audio_path, language="so", task="translate", fp16=fp16)
        segments, singing_ratio = estimate_singing_segments(list(somali.get("segments", [])))
        confidences = [s["confidence"] for s in segments if s["confidence"] is not None]
        record = {
            "track_id": track_id,
            "somali_text": (somali.get("text") or "").strip(),
            "english_text": (english.get("text") or "").strip(),
            "segments": segments,
            "language_detected": somali.get("language"),
            "overall_confidence": round(float(np.mean(confidences)), 3) if confidences else 0.0,
            "singing_ratio": singing_ratio,
            "processing_time_sec": round(time.monotonic() - t0, 1),
        }
        out.write_text(json.dumps(record, ensure_ascii=False, indent=2))
        tlog(
            track_id,
            f"transcribed ({singing_ratio:.0%} sung) in {record['processing_time_sec']}s",
        )

    _run_per_track_stage(
        "transcribe",
        config,
        limit,
        lambda t: config.transcripts_dir / f"{t}_transcript.json",
        process,
    )
    gc.collect()


def stage_pitch(config: PipelineConfig, limit: int | None = None) -> None:
    """Phase D — CREPE pitch → Somali scale map, ornaments, per-track stats."""
    try:
        import crepe
    except ImportError as exc:
        raise SystemExit("CREPE not installed: pip install crepe tensorflow") from exc

    config.pitch_dir.mkdir(parents=True, exist_ok=True)

    def source_for(track_id: str, src: Path) -> Path:
        # The oud lives in no_vocals — that is the pitch data (session spec).
        instruments = config.separated_dir / track_id / "no_vocals.wav"
        return instruments if instruments.is_file() else src

    def process(track_id: str, src: Path, out: Path) -> None:
        samples = load_audio_mono(source_for(track_id, src), sample_rate=16000)
        time_arr, freq_arr, conf_arr, _ = crepe.predict(
            samples,
            16000,
            model_capacity="full",
            viterbi=True,
            step_size=PITCH_STEP_MS,
            verbose=0,
        )
        frames = list(
            zip(
                time_arr.astype(float).tolist(),
                freq_arr.astype(float).tolist(),
                conf_arr.astype(float).tolist(),
                strict=True,
            )
        )
        points = map_pitch_frames(frames, confidence_threshold=PITCH_CONFIDENCE_THRESHOLD)
        summary = aggregate_track_pitch(points)
        record = {
            "track_id": track_id,
            "scale_reference_hz": SOMALI_SCALE_HZ,
            "confidence_threshold": PITCH_CONFIDENCE_THRESHOLD,
            "summary": summary,
            "points": points,
        }
        out.write_text(json.dumps(record, indent=2))
        tlog(
            track_id,
            f"{summary['n_pitch_points']} voiced frames, modal center {summary['modal_center']}",
        )

    _run_per_track_stage(
        "pitch", config, limit, lambda t: config.pitch_dir / f"{t}_pitch.json", process
    )


def stage_embed(config: PipelineConfig, limit: int | None = None) -> None:
    """Phase F — MERT-v1-95M 768-d embedding per track → embeddings/<track>.npy."""
    try:
        import torch
        from transformers import AutoModel, AutoProcessor
    except ImportError as exc:
        raise SystemExit("transformers not installed: pip install transformers torch") from exc

    device = _select_torch_device()
    log.info("Loading MERT-v1-95M on %s…", device)
    processor = AutoProcessor.from_pretrained("m-a-p/MERT-v1-95M", trust_remote_code=True)
    model = AutoModel.from_pretrained("m-a-p/MERT-v1-95M", trust_remote_code=True).to(device)
    model.eval()
    target_sr = int(processor.sampling_rate)
    config.embeddings_dir.mkdir(parents=True, exist_ok=True)

    def process(track_id: str, src: Path, out: Path) -> None:
        samples = load_audio_mono(src, sample_rate=target_sr)
        # MERT context is short music windows; average window embeddings over
        # the track so one vector represents the whole recording.
        window = target_sr * 30
        chunks = [samples[i : i + window] for i in range(0, len(samples), window)]
        chunks = [c for c in chunks if len(c) >= target_sr]  # ≥1 s of audio
        vectors: list[np.ndarray] = []
        with torch.no_grad():
            for chunk in chunks:
                inputs = processor(chunk, sampling_rate=target_sr, return_tensors="pt")
                inputs = {k: v.to(device) for k, v in inputs.items()}
                hidden = model(**inputs, output_hidden_states=True).hidden_states
                stacked = torch.stack(hidden).squeeze(1)  # (layers, time, 768)
                vectors.append(stacked.mean(dim=(0, 1)).cpu().numpy())
        if not vectors:
            raise RuntimeError("track shorter than 1 s — no embedding computed")
        embedding = np.mean(vectors, axis=0)
        embedding /= np.linalg.norm(embedding) + 1e-12  # cosine == dot product
        np.save(out, embedding.astype(np.float32))
        tlog(track_id, f"embedded {len(chunks)} windows → 768-d")

    _run_per_track_stage(
        "embed", config, limit, lambda t: config.embeddings_dir / f"{t}.npy", process
    )
    gc.collect()


def stage_assemble(config: PipelineConfig, limit: int | None = None) -> None:
    """Phase G — merge all per-track artifacts into the master dataset files."""
    import pandas as pd

    df = _load_inventory(config)
    config.dataset_dir.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        track_id = str(row["track_id"])
        if "duplicate_of" in str(row.get("flags") or ""):
            continue
        record: dict[str, Any] = {
            "track_id": track_id,
            "source": "Harvard AWM Spec Coll 103",
            "license": "CC BY 4.0 (catalog metadata) / research use (audio)",
            "filename": row["filename"],
            "title": None if pd.isna(row.get("title")) else row["title"],
            "artists": []
            if pd.isna(row.get("artists"))
            else [a.strip() for a in str(row["artists"]).split(",")],
            "duration_sec": (
                None if pd.isna(row.get("duration_sec")) else float(row["duration_sec"])
            ),
            "cassette": None
            if pd.isna(row.get("cassette_number"))
            else f"cassette_{int(row['cassette_number']):03d}",
            "side": None if pd.isna(row.get("side")) else row["side"],
            "files": {"original": str(Path(str(row["source_dir"])) / str(row["filename"]))},
        }
        quality_path = config.quality_dir / f"{track_id}.json"
        if quality_path.is_file():
            q = json.loads(quality_path.read_text())
            record["quality"] = {k: q[k] for k in q if k != "track_id"}
        transcript_path = config.transcripts_dir / f"{track_id}_transcript.json"
        if transcript_path.is_file():
            t = json.loads(transcript_path.read_text())
            record["transcript_somali"] = t.get("somali_text")
            record["transcript_english"] = t.get("english_text")
            record["transcript_confidence"] = t.get("overall_confidence")
            record["singing_ratio"] = t.get("singing_ratio")
            record["files"]["transcript"] = str(transcript_path)
        pitch_path = config.pitch_dir / f"{track_id}_pitch.json"
        if pitch_path.is_file():
            p = json.loads(pitch_path.read_text())
            summary = p.get("summary", {})
            record["dominant_notes"] = summary.get("dominant_notes")
            record["modal_center"] = summary.get("modal_center")
            record["avg_cents_deviation"] = summary.get("avg_cents_deviation")
            record["ornament_types"] = summary.get("ornaments")
            record["files"]["pitch_data"] = str(pitch_path)
        embedding_path = config.embeddings_dir / f"{track_id}.npy"
        if embedding_path.is_file():
            record["files"]["embedding"] = str(embedding_path)
        for name, directory, suffix in (
            ("cleaned", config.cleaned_dir, ".wav"),
            ("vocals", config.separated_dir / track_id, "vocals.wav"),
            ("instruments", config.separated_dir / track_id, "no_vocals.wav"),
        ):
            candidate = (
                directory / suffix
                if suffix.endswith("vocals.wav")
                else directory / f"{track_id}{suffix}"
            )
            if candidate.is_file():
                record["files"][name] = str(candidate)
        records.append(record)
        if limit and len(records) >= limit:
            break

    full = config.dataset_dir / "somali_music_dataset_v1.json"
    full.write_text(json.dumps(records, ensure_ascii=False, indent=2))
    pd.json_normalize(records).to_csv(
        config.dataset_dir / "somali_music_dataset_v1.csv", index=False
    )
    lite = [{k: v for k, v in r.items() if k != "files"} for r in records]
    (config.dataset_dir / "somali_music_dataset_v1_lite.json").write_text(
        json.dumps(lite, ensure_ascii=False, indent=2)
    )
    log.info("Assembled %d records → %s", len(records), config.dataset_dir)


STAGES: dict[str, Any] = {
    "inventory": stage_inventory,
    "quality": stage_quality,
    "clean": stage_clean,
    "separate": stage_separate,
    "normalize": stage_normalize,
    "transcribe": stage_transcribe,
    "pitch": stage_pitch,
    "embed": stage_embed,
    "assemble": stage_assemble,
}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("stage", choices=[*STAGES, "all"], help="pipeline stage to run")
    parser.add_argument(
        "--limit", type=int, default=None, help="process at most N tracks (smoke runs)"
    )
    parser.add_argument("--data-root", type=Path, default=None, help="override the data/ tree")
    parser.add_argument(
        "--audio-dir",
        type=Path,
        action="append",
        default=None,
        help="corpus directory (repeatable); overrides auto-discovery",
    )
    parser.add_argument("--catalog-csv", type=Path, default=None, help="HOLLIS catalog export CSV")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    setup_logging(args.verbose)
    config = default_config()
    if args.data_root or args.audio_dir or args.catalog_csv:
        config = PipelineConfig(
            data_root=args.data_root or config.data_root,
            audio_dirs=tuple(args.audio_dir) if args.audio_dir else config.audio_dirs,
            catalog_csv=args.catalog_csv or config.catalog_csv,
        )

    stages: Iterable[str] = STAGES if args.stage == "all" else (args.stage,)
    for name in stages:
        log.info("=== stage: %s ===", name)
        STAGES[name](config, limit=args.limit)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
