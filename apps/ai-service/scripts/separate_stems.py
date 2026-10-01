"""Demucs htdemucs_ft source separation over every full mix of every corpus.

# .gitignore patterns this script's outputs need (owned by the "report" builder):
#   data/separated/
# (*.wav is already ignored repo-wide; stems.json / index.jsonl carry only
#  source paths, sha256s and stem statistics, never audio.)

Walks the full mixes of the Ahmed inventory, the Harvard fetch and any extra
inventory (internet / contributor rows), runs Demucs ``htdemucs_ft`` on each
one and keeps the two stems the melody and vocal pipelines use:

  data/separated/<corpus>/<sha12>/other.wav    the oud lands in Demucs' "other"
  data/separated/<corpus>/<sha12>/vocals.wav
  data/separated/<corpus>/<sha12>/stems.json   provenance + per-stem statistics
  data/separated/index.jsonl                   one row per stems.json

Both wavs are 32 kHz mono PCM_16 (the MusicGen / EnCodec rate, so
build_sets.py can cut them like any other source). Drums and bass are only
measured (RMS), never written. <corpus> is ``ahmed`` (GarageBand / Logic
sessions), ``ahmed_collection`` (the oud_ilkacase "_mixed" files), ``harvard``
or, for --extra-inventory rows, the row's rights tier (``internet_cc``,
``contrib_<name>``, ...). <sha12> is the first 12 hex digits of the source's
full sha256, the same song identity build_sets.py uses.

Selection (the Ahmed and Harvard rules are imported from scripts.build_sets):
  * Ahmed: ``select_ahmed(rows, "ahmed_mix")`` -- content == full_mix, not
    excluded, not third_party_suspect (--include-third-party admits the
    suspects), plus every ahmed_collection row whose name contains "mixed".
  * Harvard: ``select_harvard(manifest_rows, load_catalog(...))`` -- exactly
    the files harvard_full uses, so a whole cassette side superseded by its
    track files is never separated twice. The manifest is read as it is at run
    time; the fetch job may still be adding rows and a later run picks them up.
  * Extra inventories (ahmed_files schema plus a ``rights`` field) follow
    build_sets.select_generic's gates -- rows without ``rights`` are skipped,
    ``internet_research_only`` rows are skipped by policy, third-party suspects
    unless --include-third-party, the tier must be ``internet_cc`` or
    ``contrib_<slug>_(consented|research_only)`` (it doubles as the corpus
    directory), the audio must lie under data/ -- with a looser content rule:
    content full_mix, or role_guess song|mixdown when the row carries no
    contradicting content label (internet inventories rarely have labels).
  A source that appears in two corpora is separated once (first corpus wins).
  Files shorter than MIN_SECONDS (1 s) are never sent to Demucs: a known short
  duration drops the row at selection ("too_short"), an unknown one is caught
  after the decode and counted under the run summary's ``skipped``, not as a
  failure, so it is not retried with a model load.

Per source file: decode to stereo 44.1 kHz float32 with ffmpeg (a mono source
is duplicated onto both channels, not -3 dB panned as ffmpeg's ``-ac 2`` would
do), normalise by the mean channel's mean / std exactly like the demucs CLI,
``apply_model(model, x, device, shifts=0, split=True, overlap=0.25)``
(deterministic: no random shifts), undo the normalisation, downmix each stem
to mono, resample 44.1 -> 32 kHz with scipy.signal.resample_poly, write
other.wav and vocals.wav through ``.part.wav`` temporaries and os.replace.

Statistics: RMS in dBFS of every stem (mono downmix) and of the input mix
(``mix_rms_dbfs``, so a level-relative gate can be applied later without
re-separating); the pentatonic scorer
(scripts.pcs.extract_f0 / score_frames, CREPE full at 20 ms hop) on up to three
evenly spaced 30 s windows of the ``other`` stem, averaged (pcs,
tuning_offset_cents, voiced_fraction, majority tonic), and the voiced fraction
of the ``vocals`` stem the same way. ``oud_present`` = other RMS >=
--min-stem-dbfs AND other voiced_fraction >= 0.15; ``vocals_present`` = vocals
RMS >= --min-stem-dbfs. A mix without an oud therefore lands with
oud_present=false and build_sets can skip its stem.

Resumable and shardable: a source whose stems.json exists is skipped, a
``.part.wav`` left by a crash is deleted and the file redone, --shard I/N
(0-based) takes the selected files whose sha256 hashes to shard I of N
(``int(sha256[:8], 16) % N``, so a manifest that grows between two shard
starts never moves a file from one shard to the other), every job re-checks
stems.json right before it starts and takes a per-file ``.lock`` (pid inside;
a lock whose pid is dead is stale and taken over) so two processes never
write the same stem, and the index is rebuilt from a scan of
``*/*/stems.json`` through a uniquely named temporary at the end of every run
(also after Ctrl-C). Progress is printed per file with the realtime factor; a
JSON summary closes the run. Exit status: 0 when every pending file was
separated or skipped, 1 when any file failed, 130 after Ctrl-C.

Errors from ffprobe / ffmpeg are re-raised as RuntimeError carrying the
tool's stderr (the actual reason), not just the command line.

Throughput: measured 2026-09-26 on this Mac (MPS, htdemucs_ft BagOfModels,
shifts=0, split=True, overlap=0.25) at about 7.6x realtime on a 220 s stereo
mix, 3.4 GB of GPU driver memory; the scorer adds up to 6 x 30 s of CREPE per
file. ``--probe N`` separates N pending files and prints the measured
throughput so the estimate can be refreshed before a long run.

Usage (from apps/ai-service, HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false):
  python -m scripts.separate_stems --dry-run
  python -m scripts.separate_stems --probe 2 --out /path/to/scratch/separated
  python -m scripts.separate_stems --shard 0/2 &  python -m scripts.separate_stems --shard 1/2
  python -m scripts.separate_stems --extra-inventory data/inventory/internet_cc.jsonl --limit 20
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
from collections import Counter
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path

import demucs
import numpy as np
import soundfile as sf
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model
from scipy.signal import resample_poly

from scripts.build_sets import (
    DATA_DIR,
    REPO,
    RIGHTS_CONTRIB_PREFIX,
    RIGHTS_INTERNET_CC,
    RIGHTS_INTERNET_RESEARCH,
    Selection,
    group_key,
    is_under,
    load_catalog,
    load_jsonl,
    rel_str,
    resolve_path,
    rms_dbfs,
    row_excluded,
    row_sha256,
    select_ahmed,
    select_harvard,
)
from scripts.pcs import CONF_THRESH, CREPE_SR, FMAX, FMIN, HOP, extract_f0, score_frames

DEFAULT_CLASSIFIED = "data/inventory/ahmed_classified.jsonl"
DEFAULT_MANIFEST = "data/harvard_raw/manifest.jsonl"
DEFAULT_CATALOG = "data/harvard_catalog/mus00044.csv"
DEFAULT_OUT = "data/separated"

MODEL_NAME = "htdemucs_ft"
MODEL_SR = 44100
"""htdemucs_ft's native rate; the loaded model's ``samplerate`` is used when it differs."""
OUT_SR = 32000
OVERLAP = 0.25
SHIFTS = 0
WRITTEN_STEMS = ("other", "vocals")
MEASURED_STEMS = ("drums", "bass", "other", "vocals")
WINDOW_S = 30.0
MAX_WINDOWS = 3
OUD_VOICED_MIN = 0.15
DEFAULT_MIN_STEM_DBFS = -35.0
EXPECTED_REALTIME = 7.6
"""Realtime factor measured on MPS for a 220 s stereo mix (see the module docstring)."""
INDEX_NAME = "index.jsonl"
STEMS_JSON = "stems.json"
PART_SUFFIX = ".part.wav"
LOCK_NAME = ".lock"
LOCK_EMPTY_STALE_S = 60.0
"""A lock file with no pid in it yet counts as stale once it is this old."""
MIN_SECONDS = 1.0
"""Sources shorter than this are skipped, never separated (Demucs pads them into garbage)."""
HOP_MS = round(1000.0 * HOP / CREPE_SR, 1)
"""CREPE hop of scripts.pcs, recorded in every stems.json as provenance."""
EXIT_FAILED = 1
EXIT_INTERRUPTED = 130

CORPUS_HARVARD = "harvard"
CORPUS_AHMED = "ahmed"
CORPUS_COLLECTION = "ahmed_collection"
EXTRA_ROLES = ("song", "mixdown")
EXTRA_RIGHTS_RE = re.compile(rf"{re.escape(RIGHTS_INTERNET_CC)}|{re.escape(RIGHTS_CONTRIB_PREFIX)}[a-z0-9_]+_(consented|research_only)")
"""Rights tiers an --extra-inventory row may carry (the tier is also the corpus directory name)."""


class SkipJob(Exception):
    """A pending file that must not be separated now; ``reason`` is the summary key."""

    def __init__(self, reason: str, detail: str = "") -> None:
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason
        self.detail = detail


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------


@dataclass
class Job:
    """One full mix to separate."""

    corpus: str
    path: Path
    sha256: str
    rights: str
    name: str
    duration_s: float | None
    song_group: str = ""
    project: str = ""
    third_party_suspect: bool = False
    third_party_reason: str | None = None

    @property
    def sha12(self) -> str:
        return self.sha256[:12]

    def out_dir(self, out_root: Path) -> Path:
        return out_root / self.corpus / self.sha12


def _third_party_flags(rows: list[dict], root: Path) -> dict[str, tuple[bool, str | None]]:
    """(third_party_suspect, third_party_reason) of every row, keyed by its sha256 and by its resolved path."""
    flags: dict[str, tuple[bool, str | None]] = {}
    for row in rows:
        val = (bool(row.get("third_party_suspect")), str(row["third_party_reason"]) if row.get("third_party_reason") else None)
        sha = str(row.get("sha256") or "").lower()
        if sha:
            flags[sha] = val
        if row.get("path"):
            flags[str(resolve_path(str(row["path"]), root).resolve())] = val
    return flags


def _jobs_from_selection(sel: Selection, corpus_of, flags: dict[str, tuple[bool, str | None]] | None = None) -> list[Job]:
    jobs: list[Job] = []
    for f in sel.files:
        suspect, reason = (flags or {}).get(f.sha256) or (flags or {}).get(str(f.path.resolve())) or (False, None)
        jobs.append(Job(corpus=corpus_of(f), path=f.path, sha256=f.sha256, rights=f.rights, name=f.name,
                        duration_s=f.duration_s, song_group=f.song_group, project=f.project,
                        third_party_suspect=suspect, third_party_reason=reason))
    return jobs


def select_extra(rows: list[dict], root: Path = REPO, include_third_party: bool = False) -> tuple[list[Job], Counter]:
    """Rows of an extra inventory (ahmed_files schema + ``rights``) that are full mixes.

    The rights gates are build_sets.select_generic's: no ``rights`` -> skipped,
    ``internet_research_only`` -> skipped by policy, third-party suspects ->
    skipped unless ``include_third_party``, the audio must lie under data/. The
    tier must match EXTRA_RIGHTS_RE because it doubles as the corpus directory
    name. The content rule is looser than select_generic's: content ==
    full_mix, or role_guess song|mixdown when the row carries no contradicting
    content label (an internet inventory rarely has classifier labels)."""
    skipped: Counter = Counter()
    chosen: dict[str, Job] = {}
    roots = [root / DATA_DIR]
    for row in rows:
        if row_excluded(row):
            skipped["excluded"] += 1
            continue
        rights = str(row.get("rights") or "").strip()
        if not rights:
            skipped["no_rights"] += 1
            continue
        if rights == RIGHTS_INTERNET_RESEARCH:
            skipped["rights_internet_research_only_by_policy"] += 1
            continue
        if not EXTRA_RIGHTS_RE.fullmatch(rights):
            skipped["bad_rights"] += 1
            continue
        suspect = bool(row.get("third_party_suspect"))
        reason = str(row["third_party_reason"]) if row.get("third_party_reason") else None
        if suspect and not include_third_party:
            skipped[f"third_party_{reason or 'suspect'}"] += 1
            continue
        content = str(row.get("content") or "")
        role = str(row.get("role_guess") or "")
        if content != "full_mix" and not (not content and role in EXTRA_ROLES):
            skipped[f"content_{content or role or 'none'}"] += 1
            continue
        raw = row.get("path") or ""
        if not raw:
            skipped["no_path"] += 1
            continue
        path = resolve_path(str(raw), root)
        if not is_under(path, roots):
            skipped["outside_roots"] += 1
            continue
        if not path.exists():
            skipped["missing_file"] += 1
            continue
        sha = row_sha256(row, path)
        if sha in chosen:
            skipped["duplicate_sha256"] += 1
            continue
        chosen[sha] = Job(
            corpus=rights, path=path, sha256=sha, rights=rights, name=str(row.get("name") or path.name),
            duration_s=_float_or_none(row.get("duration_s")), song_group=group_key(row),
            project=str(row.get("project") or ""), third_party_suspect=suspect, third_party_reason=reason,
        )
    return [chosen[s] for s in sorted(chosen)], skipped


def _float_or_none(val: object) -> float | None:
    try:
        return None if val is None else float(val)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def select_jobs(
    classified: list[dict],
    manifest: list[dict],
    catalog: dict[str, dict],
    extras: Iterable[list[dict]] = (),
    root: Path = REPO,
    include_third_party: bool = False,
) -> tuple[list[Job], Counter]:
    """Every full mix of every corpus, unique by sha256, sorted by (corpus, sha256).

    Rows whose inventory duration is known and under MIN_SECONDS are dropped
    ("too_short"); Ahmed jobs carry the classifier's third_party_suspect flag."""
    skipped: Counter = Counter()
    jobs: list[Job] = []
    if classified:
        sel = select_ahmed(classified, "ahmed_mix", root=root, include_third_party=include_third_party)
        jobs += _jobs_from_selection(
            sel, lambda f: CORPUS_COLLECTION if f.extra.get("source_group") == CORPUS_COLLECTION else CORPUS_AHMED,
            flags=_third_party_flags(classified, root))
        skipped.update({f"ahmed:{k}": v for k, v in sel.skipped.items()})
    if manifest:
        sel = select_harvard(manifest, catalog, root=root)
        jobs += _jobs_from_selection(sel, lambda f: CORPUS_HARVARD)
        skipped.update({f"harvard:{k}": v for k, v in sel.skipped.items()})
    for rows in extras:
        extra_jobs, extra_skipped = select_extra(rows, root=root, include_third_party=include_third_party)
        jobs += extra_jobs
        skipped.update({f"extra:{k}": v for k, v in extra_skipped.items()})
    unique: dict[str, Job] = {}
    for job in jobs:
        if job.sha256 in unique:
            skipped["duplicate_sha256_across_corpora"] += 1
            continue
        if job.duration_s is not None and job.duration_s < MIN_SECONDS:
            skipped["too_short"] += 1
            continue
        unique[job.sha256] = job
    return sorted(unique.values(), key=lambda j: (j.corpus, j.sha256)), skipped


def shard_of(sha256: str, shard_n: int) -> int:
    """Stable shard of a file: the first 32 bits of its sha256 modulo N (independent of the selection's size)."""
    return int(sha256[:8], 16) % shard_n


def parse_shard(spec: str) -> tuple[int, int]:
    """'I/N' -> (I, N), 0 <= I < N (0-based, like ahmed_classify --shard)."""
    try:
        i, n = (int(x) for x in spec.split("/"))
    except ValueError as e:
        raise SystemExit(f"bad --shard {spec!r}: want I/N with 0 <= I < N") from e
    if not (n > 0 and 0 <= i < n):
        raise SystemExit(f"bad --shard {spec!r}: want I/N with 0 <= I < N")
    return i, n


def hours(jobs: Iterable[Job]) -> float:
    return round(sum(j.duration_s or 0.0 for j in jobs) / 3600.0, 3)


# ---------------------------------------------------------------------------
# Audio I/O
# ---------------------------------------------------------------------------


def _run_tool(cmd: list[str], path: Path) -> bytes:
    """stdout of an ffmpeg / ffprobe command; a non-zero exit becomes a RuntimeError carrying the stderr."""
    try:
        return subprocess.run(cmd, capture_output=True, check=True).stdout
    except subprocess.CalledProcessError as e:
        err = (e.stderr or b"").decode("utf-8", errors="replace").strip().splitlines()
        # ffmpeg / ffprobe prefix the line with the full source path; keep the reason, not the path
        reason = err[-1].replace(str(path), path.name).strip()[:200] if err else f"exit status {e.returncode}"
        raise RuntimeError(f"{cmd[0]} failed on {path.name!r}: {reason}") from e
    except FileNotFoundError as e:
        raise RuntimeError(f"{cmd[0]} is not installed (needed for {path.name!r})") from e


def probe_channels(path: Path) -> int:
    out = _run_tool(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "csv=p=0", str(path)],
        path,
    ).decode("utf-8", errors="replace")
    first = out.strip().splitlines()[0].strip() if out.strip() else ""
    return int(first) if first.isdigit() else 2


def decode_stereo(path: Path, sr: int = MODEL_SR) -> np.ndarray:
    """(2, n) float32 at ``sr``: mono duplicated onto both channels, >2 channels downmixed by ffmpeg."""
    mono = probe_channels(path) == 1
    raw = _run_tool(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1" if mono else "2", "-ar", str(sr), "-f", "f32le", "-"], path,
    )
    x = np.frombuffer(raw, dtype=np.float32).copy()  # a writable array: torch.from_numpy warns on a read-only buffer
    if mono:
        return np.stack([x, x])
    return np.ascontiguousarray(x.reshape(-1, 2).T)


def separate(model, mix: np.ndarray, device: str) -> dict[str, np.ndarray]:
    """Demucs stems of a (2, n) mix, keyed by source name, at the model's rate.

    The demucs CLI recipe: normalise by the mean channel's mean and std, apply
    with no random shifts (deterministic) and 25 % segment overlap, undo."""
    x = torch.from_numpy(np.ascontiguousarray(mix, dtype=np.float32))
    ref = x.mean(0)
    mean = ref.mean()
    std = ref.std()
    if not torch.isfinite(std) or float(std) <= 0.0:
        std = torch.tensor(1.0)
    x = (x - mean) / std
    with torch.no_grad():
        out = apply_model(model, x[None], device=device, shifts=SHIFTS, split=True, overlap=OVERLAP, progress=False)[0]
    out = out * std + mean
    return {name: out[i].cpu().numpy() for i, name in enumerate(model.sources)}


def to_mono32(stem: np.ndarray, sr_in: int, sr_out: int = OUT_SR) -> np.ndarray:
    """Mono downmix, polyphase resample to ``sr_out``, clipped to [-1, 1], float32."""
    mono = np.asarray(stem, dtype=np.float64)
    if mono.ndim == 2:
        mono = mono.mean(axis=0)
    if sr_in != sr_out:
        g = math.gcd(sr_out, sr_in)
        mono = resample_poly(mono, sr_out // g, sr_in // g)
    return np.clip(mono, -1.0, 1.0).astype(np.float32)


def write_wav_atomic(path: Path, audio: np.ndarray, sr: int) -> None:
    part = path.with_name(path.stem + PART_SUFFIX)
    sf.write(part, audio, sr, subtype="PCM_16")
    os.replace(part, path)


def write_json_atomic(path: Path, obj: dict) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n")
    os.replace(tmp, path)


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


def scorer_windows(n_samples: int, sr: int = OUT_SR, seconds: float = WINDOW_S, max_windows: int = MAX_WINDOWS) -> list[int]:
    """Start samples of up to ``max_windows`` evenly spaced ``seconds`` windows (whole signal when shorter)."""
    win = int(seconds * sr)
    if n_samples <= win:
        return [0]
    k = min(max_windows, n_samples // win)
    if k <= 1:
        return [(n_samples - win) // 2]
    return [int(round(i * (n_samples - win) / (k - 1))) for i in range(k)]


def score_stem(stem32: np.ndarray, device: str, want_pcs: bool, sr: int = OUT_SR,
               max_windows: int = MAX_WINDOWS) -> tuple[dict, list[int]]:
    """Scorer statistics averaged over the windows: voiced_fraction always, pcs / tuning / tonic when asked.

    Digital silence (peak 0) is not sent to CREPE: it scores voiced_fraction 0
    (CREPE's periodicity on zeros sits far under the 0.5 gate anyway).
    The vocals stem is scored on one window only (its voiced fraction gates nothing;
    the level gate decides vocals_present), which removes a third of the CREPE cost."""
    starts = scorer_windows(len(stem32), sr, max_windows=max_windows)
    win = int(WINDOW_S * sr)
    out: dict = {"voiced_fraction": 0.0}
    if want_pcs:
        out.update({"pcs": None, "tuning_offset_cents": None, "tonic": None})
    if len(stem32) == 0 or float(np.max(np.abs(stem32))) == 0.0:
        return out, starts
    voiced_fractions: list[float] = []
    pcs: list[float] = []
    tuning: list[float] = []
    tonics: list[str] = []
    for start in starts:
        clip = stem32[start:start + win]
        f0, pd = extract_f0(clip, device, sr)
        voiced = (pd >= CONF_THRESH) & (f0 > FMIN) & (f0 < FMAX)
        voiced_fractions.append(float(voiced.mean()) if voiced.size else 0.0)
        if want_pcs:
            res = score_frames(f0, pd)
            if res is not None:
                pcs.append(res.pcs)
                tuning.append(res.tuning_offset_cents)
                tonics.append(res.tonic_name)
    out["voiced_fraction"] = round(float(np.mean(voiced_fractions)), 4)
    if want_pcs:
        out["pcs"] = round(float(np.mean(pcs)), 4) if pcs else None
        out["tuning_offset_cents"] = round(float(np.mean(tuning)), 1) if tuning else None
        out["tonic"] = Counter(tonics).most_common(1)[0][0] if tonics else None
    return out, starts


def oud_present(other: dict, min_stem_dbfs: float) -> bool:
    return bool(other["rms_dbfs"] >= min_stem_dbfs and (other.get("voiced_fraction") or 0.0) >= OUD_VOICED_MIN)


def vocals_present(vocals: dict, min_stem_dbfs: float) -> bool:
    return bool(vocals["rms_dbfs"] >= min_stem_dbfs)


# ---------------------------------------------------------------------------
# Per-file processing and the index
# ---------------------------------------------------------------------------


def clean_partials(out_dir: Path) -> int:
    """Delete ``*.part.wav`` (and ``stems.json.tmp``) left by a crash; the file is redone."""
    n = 0
    if not out_dir.exists():
        return 0
    for p in list(out_dir.glob(f"*{PART_SUFFIX}")) + list(out_dir.glob("*.json.tmp")):
        p.unlink()
        n += 1
    return n


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def lock_is_stale(lock: Path) -> bool:
    """A lock whose pid is dead, or that has held no pid for LOCK_EMPTY_STALE_S, was left by a crash."""
    try:
        text = lock.read_text().strip()
        if text.isdigit():
            return not _pid_alive(int(text))
        return time.time() - lock.stat().st_mtime > LOCK_EMPTY_STALE_S
    except OSError:
        return False


@contextlib.contextmanager
def claim(out_dir: Path) -> Iterator[Path]:
    """Hold ``<out_dir>/.lock`` (created O_EXCL, this pid inside) while a file is being separated.

    Raises SkipJob("locked") when another live process holds it; a stale lock
    is taken over. On exit the lock goes, and so does ``out_dir`` when nothing
    else was written into it (a failed or skipped file leaves no empty dir)."""
    lock = out_dir / LOCK_NAME
    fd: int | None = None
    try:  # everything from the mkdir on is inside the try: a Ctrl-C in the claim itself leaves no empty dir
        out_dir.mkdir(parents=True, exist_ok=True)
        for _attempt in range(2):
            try:
                fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
                break
            except FileExistsError:
                if lock_is_stale(lock):
                    with contextlib.suppress(OSError):
                        lock.unlink()
                    continue
                raise SkipJob("locked", f"{lock} held by a live process") from None
        if fd is None:
            raise SkipJob("locked", f"{lock} could not be taken over")
        os.write(fd, str(os.getpid()).encode("ascii"))
        os.close(fd)
        yield lock
    finally:
        try:
            if fd is not None:  # only our own lock, never another live process's
                with contextlib.suppress(OSError):
                    lock.unlink()
        finally:
            with contextlib.suppress(OSError):
                out_dir.rmdir()  # only succeeds when the directory is empty


def process_job(job: Job, model, out_root: Path, device: str, min_stem_dbfs: float, root: Path = REPO) -> dict:
    """Decode, separate, write other/vocals at 32 kHz mono and stems.json; return the stems.json dict.

    Raises SkipJob("too_short") for a source under MIN_SECONDS (nothing is written).
    The output directory is only created once the separation has succeeded."""
    t_start = time.perf_counter()
    out_dir = job.out_dir(out_root)
    clean_partials(out_dir)
    model_sr = int(getattr(model, "samplerate", MODEL_SR))
    mix = decode_stereo(job.path, model_sr)
    duration_s = mix.shape[1] / model_sr
    if duration_s < MIN_SECONDS:
        raise SkipJob("too_short", f"{duration_s:.3f} s < {MIN_SECONDS} s")
    mix_rms = round(rms_dbfs(mix.mean(axis=0)), 2)
    t_sep = time.perf_counter()
    stems = separate(model, mix, device)
    sep_seconds = time.perf_counter() - t_sep
    del mix

    stats: dict[str, dict] = {}
    for name in MEASURED_STEMS:
        if name not in stems:
            continue
        stats[name] = {"rms_dbfs": round(rms_dbfs(stems[name].mean(axis=0)), 2)}
    windows: list[int] = []
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in WRITTEN_STEMS:
        if name not in stems:
            continue
        mono32 = to_mono32(stems[name], model_sr)
        write_wav_atomic(out_dir / f"{name}.wav", mono32, OUT_SR)
        scored, starts = score_stem(mono32, device, want_pcs=(name == "other"),
                                    max_windows=MAX_WINDOWS if name == "other" else 1)
        stats[name].update(scored)
        stats[name]["file"] = f"{name}.wav"
        if name == "other":
            windows = starts
    del stems

    record = {
        "source_path": rel_str(job.path, root),
        "source_sha256": job.sha256,
        "corpus": job.corpus,
        "rights": job.rights,
        "name": job.name,
        "song_group": job.song_group,
        "project": job.project,
        "third_party_suspect": job.third_party_suspect,
        "third_party_reason": job.third_party_reason,
        "duration_s": round(duration_s, 3),
        "mix_rms_dbfs": mix_rms,
        "sample_rate": OUT_SR,
        "channels": 1,
        "stem_dir": rel_str(out_dir, root),
        "model": MODEL_NAME,
        "demucs_version": str(getattr(demucs, "__version__", "unknown")),
        "device": device,
        "stems": stats,
        "oud_present": oud_present(stats["other"], min_stem_dbfs) if "other" in stats else False,
        "vocals_present": vocals_present(stats["vocals"], min_stem_dbfs) if "vocals" in stats else False,
        "min_stem_dbfs": min_stem_dbfs,
        "scorer": {"window_seconds": WINDOW_S, "max_windows": MAX_WINDOWS, "hop_ms": HOP_MS,
                   "window_starts_s": [round(s / OUT_SR, 2) for s in windows], "oud_voiced_min": OUD_VOICED_MIN},
        "seconds_separation": round(sep_seconds, 3),
        "realtime_factor": round(duration_s / sep_seconds, 2) if sep_seconds > 0 else None,
        "seconds_elapsed": round(time.perf_counter() - t_start, 3),
        "written_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
    }
    write_json_atomic(out_dir / STEMS_JSON, record)
    return record


def append_index(out_root: Path, record: dict) -> None:
    with open(out_root / INDEX_NAME, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def scan_records(out_root: Path) -> list[dict]:
    rows: list[dict] = []
    for p in sorted(out_root.glob(f"*/*/{STEMS_JSON}")):
        try:
            rows.append(json.loads(p.read_text()))
        except (json.JSONDecodeError, OSError) as e:
            print(f"index: unreadable {p}: {e}", file=sys.stderr)
    rows.sort(key=lambda r: (str(r.get("corpus", "")), str(r.get("source_sha256", ""))))
    return rows


def rebuild_index(out_root: Path) -> int:
    """Rewrite index.jsonl from every */*/stems.json through a uniquely named temporary.

    Safe for concurrent callers (shards ending together, threads): each writes
    its own ``index.jsonl.<random>.tmp`` and the last os.replace wins with a
    complete file; a shared temp name would let the loser's replace fail."""
    rows = scan_records(out_root)
    out_root.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=out_root, prefix=INDEX_NAME + ".", suffix=".tmp")
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        os.replace(tmp, out_root / INDEX_NAME)
    except BaseException:
        with contextlib.suppress(OSError):
            tmp.unlink()
        raise
    return len(rows)


def is_done(job: Job, out_root: Path) -> bool:
    return (job.out_dir(out_root) / STEMS_JSON).exists()


def resolve_device(requested: str) -> str:
    if requested == "mps" and not torch.backends.mps.is_available():
        print("mps not available, falling back to cpu", file=sys.stderr)
        return "cpu"
    if requested == "cuda" and not torch.cuda.is_available():
        print("cuda not available, falling back to cpu", file=sys.stderr)
        return "cpu"
    return requested


def _progress_line(i: int, n: int, job: Job, rec: dict) -> str:
    other = rec["stems"].get("other", {})
    vocals = rec["stems"].get("vocals", {})
    return (
        f"[{i}/{n}] {job.corpus} {job.sha12} {job.name!r} {rec['duration_s']:.1f} s  "
        f"sep {rec['seconds_separation']:.1f} s ({rec['realtime_factor'] or 0:.1f}x)  "
        f"total {rec['seconds_elapsed']:.1f} s  "
        f"other {other.get('rms_dbfs', -180):.1f} dBFS vf {other.get('voiced_fraction', 0):.2f} oud={'yes' if rec['oud_present'] else 'no'}  "
        f"vocals {vocals.get('rms_dbfs', -180):.1f} dBFS vocals={'yes' if rec['vocals_present'] else 'no'}"
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--classified", default=DEFAULT_CLASSIFIED, help="Ahmed classified inventory (jsonl)")
    ap.add_argument("--harvard-manifest", default=DEFAULT_MANIFEST, help="harvard_fetch manifest (jsonl)")
    ap.add_argument("--harvard-catalog", default=DEFAULT_CATALOG, help="finding-aid CSV export")
    ap.add_argument("--extra-inventory", action="append", default=[], metavar="JSONL",
                    help="extra inventory in the ahmed_files schema with a rights field (repeatable)")
    ap.add_argument("--out", default=DEFAULT_OUT, help="output root: <out>/<corpus>/<sha12>/{other,vocals}.wav + stems.json")
    ap.add_argument("--device", default="mps", help="torch device for Demucs and CREPE (mps | cpu | cuda)")
    ap.add_argument("--shard", default="",
                    help="I/N (0-based): the selected files whose sha256 hashes to shard I of N (stable when the selection grows)")
    ap.add_argument("--limit", type=int, default=0, help="separate at most N pending files")
    ap.add_argument("--probe", type=int, default=0, metavar="N",
                    help=f"separate N pending files and report throughput (expected about {EXPECTED_REALTIME}x realtime on MPS)")
    ap.add_argument("--dry-run", action="store_true", help="list what would run, with hours, and exit")
    ap.add_argument("--min-stem-dbfs", type=float, default=DEFAULT_MIN_STEM_DBFS,
                    help="a stem under this RMS counts as absent (oud_present / vocals_present)")
    ap.add_argument("--include-third-party", action="store_true",
                    help="also separate Ahmed rows the classifier flagged third_party_suspect")
    ap.add_argument("--root", default=str(REPO), help="repo root that relative inventory paths resolve against (tests)")
    args = ap.parse_args(argv)

    root = Path(args.root).expanduser().resolve()
    out_root = resolve_path(args.out, root)
    classified = load_jsonl(resolve_path(args.classified, root))
    manifest = load_jsonl(resolve_path(args.harvard_manifest, root))
    catalog = load_catalog(resolve_path(args.harvard_catalog, root))
    extras = [load_jsonl(resolve_path(p, root)) for p in args.extra_inventory]
    for label, rows, src in (("classified", classified, args.classified), ("manifest", manifest, args.harvard_manifest)):
        if not rows:
            print(f"note: no {label} rows at {src}", file=sys.stderr)
    jobs, skipped = select_jobs(classified, manifest, catalog, extras, root=root,
                                include_third_party=args.include_third_party)
    if not jobs:
        raise SystemExit(f"no full mixes selected (skipped: {dict(skipped)})")

    shard_i, shard_n = parse_shard(args.shard) if args.shard else (0, 1)
    shard = [j for j in jobs if shard_of(j.sha256, shard_n) == shard_i]
    done = [j for j in shard if is_done(j, out_root)]
    todo = [j for j in shard if not is_done(j, out_root)]
    limit = args.probe or args.limit
    if limit:
        todo = todo[:limit]
    by_corpus = {
        c: {"files": sum(1 for j in jobs if j.corpus == c), "hours": hours(j for j in jobs if j.corpus == c)}
        for c in sorted({j.corpus for j in jobs})
    }
    print(f"{len(jobs)} full mixes selected ({hours(jobs)} h) in {len(by_corpus)} corpora; "
          f"shard {args.shard or 'all'}: {len(shard)} files, {len(done)} done, {len(todo)} to run ({hours(todo)} h)", flush=True)

    if args.dry_run:
        for j in todo:
            print(f"  {j.corpus:<18} {j.sha12}  {(j.duration_s or 0) / 60:6.1f} min  {rel_str(j.path, root)}")
        summary = {
            "dry_run": True, "selected": len(jobs), "hours_selected": hours(jobs), "by_corpus": by_corpus,
            "shard": args.shard or "all", "done": len(done), "pending": len(todo), "hours_pending": hours(todo),
            "duration_unknown": sum(1 for j in todo if j.duration_s is None),
            "estimated_minutes_at_expected_realtime": round(hours(todo) * 60 / EXPECTED_REALTIME, 1),
            "skipped": dict(sorted(skipped.items())), "out": rel_str(out_root, root),
        }
        print(json.dumps(summary, ensure_ascii=False), flush=True)
        return

    device = resolve_device(args.device)
    out_root.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    records: list[dict] = []
    failures: list[dict] = []
    skipped_run: Counter = Counter()
    interrupted = False
    index_rows: int | None = None
    index_error: str | None = None
    model = None
    if todo:
        model = get_model(MODEL_NAME)
        model.eval()
    try:
        for i, job in enumerate(todo, 1):
            if is_done(job, out_root):  # finished by another shard since the list was made
                skipped_run["done_by_another_shard"] += 1
                print(f"[{i}/{len(todo)}] {job.corpus} {job.sha12} SKIPPED: done_by_another_shard", flush=True)
                continue
            try:
                with claim(job.out_dir(out_root)):
                    rec = process_job(job, model, out_root, device, args.min_stem_dbfs, root=root)
            except SkipJob as e:
                skipped_run[e.reason] += 1
                print(f"[{i}/{len(todo)}] {job.corpus} {job.sha12} SKIPPED: {e.reason} ({e.detail})", flush=True)
                continue
            except Exception as e:  # one bad file must not end a long run
                print(f"[{i}/{len(todo)}] {job.corpus} {job.sha12} FAILED: {type(e).__name__}: {str(e)[:300]}", flush=True)
                failures.append({"corpus": job.corpus, "sha12": job.sha12, "path": rel_str(job.path, root),
                                 "error": f"{type(e).__name__}: {str(e)[:300]}"})
                continue
            records.append(rec)
            append_index(out_root, rec)
            print(_progress_line(i, len(todo), job, rec), flush=True)
    except KeyboardInterrupt:
        interrupted = True
        print("interrupted: rebuilding the index from what is on disk", file=sys.stderr)
    finally:
        try:
            index_rows = rebuild_index(out_root)
        except OSError as e:  # an exit-path failure is reported in the summary, not as a traceback
            index_error = f"{type(e).__name__}: {e}"
            print(f"index: rebuild failed: {index_error}", file=sys.stderr)

    elapsed = time.perf_counter() - t0
    audio_s = sum(r["duration_s"] for r in records)
    sep_s = sum(r["seconds_separation"] for r in records)
    summary = {
        "files": len(records),
        "hours_separated": round(audio_s / 3600.0, 3),
        "oud_present": sum(1 for r in records if r["oud_present"]),
        "vocals_present": sum(1 for r in records if r["vocals_present"]),
        "elapsed": round(elapsed, 1),
        "seconds_separation": round(sep_s, 3),
        "realtime_factor": round(audio_s / sep_s, 2) if sep_s > 0 else None,
        "realtime_factor_end_to_end": round(audio_s / elapsed, 2) if elapsed > 0 and records else None,
        "expected_realtime_factor": EXPECTED_REALTIME,
        "skipped_existing": len(done),
        "skipped": dict(sorted(skipped_run.items())),
        "failed": len(failures),
        "failures": failures,
        "interrupted": interrupted,
        "shard": args.shard or "all",
        "include_third_party": args.include_third_party,
        "min_seconds": MIN_SECONDS,
        "device": device,
        "index_rows": index_rows,
        "index_error": index_error,
        "out": rel_str(out_root, root),
    }
    if args.probe:
        summary["probe"] = [
            {"corpus": r["corpus"], "sha12": r["source_sha256"][:12], "name": r["name"], "duration_s": r["duration_s"],
             "seconds_separation": r["seconds_separation"], "realtime_factor": r["realtime_factor"],
             "seconds_elapsed": r["seconds_elapsed"],
             "rms_dbfs": {k: v["rms_dbfs"] for k, v in r["stems"].items()},
             "oud_present": r["oud_present"], "vocals_present": r["vocals_present"]}
            for r in records
        ]
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    if interrupted:
        sys.exit(EXIT_INTERRUPTED)
    if failures or index_error:
        sys.exit(EXIT_FAILED)


if __name__ == "__main__":
    main()
