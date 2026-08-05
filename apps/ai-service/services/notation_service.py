"""Sheet-music notation jobs (Phase 5 Track B surface).

A job = one uploaded audio file transcribed to MusicXML/SVG/MIDI with the
pentatonic-aware pipeline. Transcription runs in the somali311 Python (basic-pitch
needs <=3.11) as a subprocess — the service process never imports TF/ONNX.

Job state lives on disk (data/notation_jobs/<id>/job.json), so a service restart
loses nothing; an in-process set tracks which jobs are actively running.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

from config import get_settings

JOBS_ROOT = Path(__file__).resolve().parents[1] / "data" / "notation_jobs"
ALLOWED_SUFFIXES = {".wav", ".mp3", ".m4a", ".flac", ".ogg"}
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
_TRANSCRIBE_TIMEOUT_S = 600
# Demucs on CPU chews ~1-2 min per song; first run also downloads weights.
_SEPARATE_TIMEOUT_S = 900

_running: set[str] = set()

# ── Single-flight execution ───────────────────────────────────────────────────
# Demucs + CREPE + basic-pitch together saturate every core. Running two jobs
# concurrently doesn't halve latency — it thrashes the machine until even the
# web servers stop answering (observed: load avg 14, all services timing out).
# One heavy pipeline at a time; the rest wait with an honest queue stage.
_heavy = threading.BoundedSemaphore(1)
_waiting: list[str] = []
_reg_lock = threading.Lock()

# ── Instrument-aware transcription ────────────────────────────────────────────
# Somali music is more than the kaban: the user picks what to transcribe.
# `stem` chooses the Demucs source, `crepe` the dedicated vocal engine, and
# the frequency band is an instrument-register prior that sheds neighbours'
# bleed and harmonics inside the shared 'other' stem.
INSTRUMENTS: dict[str, dict | None] = {
    "full": None,  # Voice + Kaban two-staff arrangement (default)
    "voice": {"stem": "vocals", "crepe": True, "part": "Voice"},
    "kaban": {"stem": "other", "crepe": False, "part": "Kaban",
              "fmin": 70.0, "fmax": 900.0},
    "violin": {"stem": "other", "crepe": False, "part": "Violin",
               "fmin": 180.0, "fmax": 2800.0},
    "flute": {"stem": "other", "crepe": False, "part": "Flute",
              "fmin": 240.0, "fmax": 2400.0},
}


class NotationError(Exception):
    pass


def job_dir(job_id: str) -> Path:
    d = JOBS_ROOT / job_id
    if not d.resolve().is_relative_to(JOBS_ROOT.resolve()):
        raise NotationError("invalid job id")
    return d


def _find_active_duplicate(digest: str, separate: bool, instrument: str) -> str | None:
    """Same bytes + same options already pending/processing/done → reuse it.

    Users re-upload when a long job LOOKS stuck; without this, every retry
    spawned another full pipeline and made the wait worse (the load-avg-14
    incident). Errored jobs never match, so a genuine retry still works.
    """
    if not JOBS_ROOT.exists():
        return None
    recent = sorted(JOBS_ROOT.iterdir(), key=lambda p: p.stat().st_mtime,
                    reverse=True)[:40]
    for d in recent:
        f = d / "job.json"
        if not f.exists():
            continue
        try:
            state = json.loads(f.read_text())
        except json.JSONDecodeError:
            continue
        if (state.get("content_hash") == digest
                and bool(state.get("separate")) == separate
                and state.get("instrument", "full") == instrument
                and state.get("status") in ("pending", "processing", "done")):
            return state["job_id"]
    return None


def create_job(filename: str, payload: bytes, separate: bool = False,
               instrument: str = "full") -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise NotationError(f"unsupported audio format {suffix or '(none)'}; "
                            f"use one of {sorted(ALLOWED_SUFFIXES)}")
    if len(payload) > MAX_UPLOAD_BYTES:
        raise NotationError("file exceeds 50 MB limit")
    if not payload:
        raise NotationError("empty upload")
    digest = hashlib.sha256(payload).hexdigest()[:16]
    if instrument not in INSTRUMENTS:
        raise NotationError(
            f"unknown instrument '{instrument}'; use one of {sorted(INSTRUMENTS)}")
    duplicate = _find_active_duplicate(digest, separate, instrument)
    if duplicate:
        return duplicate
    job_id = uuid.uuid4().hex
    d = job_dir(job_id)
    d.mkdir(parents=True)
    (d / f"input{suffix}").write_bytes(payload)
    _write(job_id, {"job_id": job_id, "status": "pending",
                    "created_at": time.time(), "input": f"input{suffix}",
                    "separate": separate, "content_hash": digest,
                    "instrument": instrument})
    return job_id


def _stage(job_id: str, text: str) -> None:
    """Publish a human-readable pipeline stage for the polling client."""
    f = job_dir(job_id) / "job.json"
    state = json.loads(f.read_text())
    _write(job_id, {**state, "stage": text})


def _separate_stems(job_id: str, audio: Path) -> dict[str, Path]:
    """Demucs 4-stem split; returns the stems that exist (vocals/other/…).

    Transcribing the vocal stem instead of the full mix is the single biggest
    accuracy win on band recordings; the 'other' stem (oud/kaban territory)
    feeds the accompaniment staff. One htdemucs pass produces all four stems
    at the same cost as a two-stem run; the first call downloads the model
    weights (~80MB).
    """
    settings = get_settings()
    python = settings.demucs_python or sys.executable
    stems_root = job_dir(job_id) / "stems"
    out_dir = stems_root / "htdemucs" / audio.stem
    # Apple-silicon GPU first (several × faster when the installed torch/demucs
    # pair supports htdemucs on MPS), transparent CPU fallback when it doesn't.
    proc = None
    for device in ("mps", "cpu"):
        cmd = [python, "-m", "demucs", "-n", "htdemucs", "-d", device,
               "-o", str(stems_root), str(audio)]
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              timeout=_SEPARATE_TIMEOUT_S)
        if proc.returncode == 0 and (out_dir / "vocals.wav").exists():
            break
    stems = {name: out_dir / f"{name}.wav" for name in ("vocals", "other")}
    stems = {k: p for k, p in stems.items() if p.exists()}
    if "vocals" not in stems:
        stderr = (proc.stderr if proc else "").strip()[-300:] or "no output"
        raise NotationError(f"vocal separation failed: {stderr}")
    return stems


def _vocal_notes(job_id: str, vocals: Path) -> Path:
    """CREPE vocal engine subprocess → notes JSON path (scripts/vocal_f0.py)."""
    settings = get_settings()
    python = settings.vocal_python or sys.executable
    out = job_dir(job_id) / "vocal_notes.json"
    cmd = [python, "-m", "scripts.vocal_f0", str(vocals), str(out)]
    proc = subprocess.run(cmd, capture_output=True, text=True,
                          timeout=_SEPARATE_TIMEOUT_S,
                          cwd=Path(__file__).resolve().parents[1])
    if proc.returncode != 0 or not out.exists():
        raise NotationError(
            f"vocal pitch tracking failed: {proc.stderr.strip()[-300:] or 'no output'}")
    return out


def run_job(job_id: str) -> None:
    """Synchronous pipeline body — invoked on a background thread (or Celery).

    IDEMPOTENT: a deduped duplicate upload still schedules a second run_job
    for the same id — that ghost must exit before touching anything, or it
    overwrites live stage text and re-runs the whole pipeline afterwards."""
    with _reg_lock:
        if job_id in _running:
            return  # already being run by another thread
        state = read_job(job_id)
        if state["status"] == "done":
            return  # deduped re-submit of a finished job
        _running.add(job_id)
    audio = job_dir(job_id) / state["input"]
    _write(job_id, {**state, "status": "processing", "stage": "starting"})
    settings = get_settings()
    acquired = False
    timings: dict[str, float] = {}
    try:
        _waiting.append(job_id)
        if not _heavy.acquire(blocking=False):
            _stage(job_id, f"waiting for an earlier job to finish "
                           f"({max(len(_waiting) - 1, 1)} ahead)")
            _heavy.acquire()
        acquired = True
        _waiting.remove(job_id)
        # Optional accuracy stage: split the mix, track the vocal line with
        # the dedicated CREPE engine, and give the oud its own staff. Every
        # sub-stage degrades gracefully — a slightly worse transcription
        # always beats a dead job — and what actually ran is recorded.
        pipeline_audio = audio
        separation = None
        extra: list[str] = []
        instrument = state.get("instrument", "full")
        spec = INSTRUMENTS.get(instrument)
        if state.get("separate"):
            try:
                _stage(job_id, "separating voice, strings, and rhythm (1–4 min)")
                t0 = time.time()
                stems = _separate_stems(job_id, audio)
                timings["separate"] = round(time.time() - t0, 1)
                if spec is None or spec.get("crepe"):
                    # Voice-led paths ("full" arrangement and "voice" solo).
                    pipeline_audio = stems["vocals"]
                    separation = "vocals"
                    try:
                        _stage(job_id, "tracking the vocal line at 10 ms resolution")
                        t0 = time.time()
                        notes_json = _vocal_notes(job_id, stems["vocals"])
                        timings["vocal_f0"] = round(time.time() - t0, 1)
                        extra += ["--melody-notes", str(notes_json)]
                        separation = "vocals+crepe"
                    except (NotationError, subprocess.TimeoutExpired, OSError):
                        pass  # basic-pitch on the vocal stem still beats the mix
                    extra += ["--part-name", "Voice"]
                    if spec is None and "other" in stems:
                        # Full arrangement: the kaban gets its own staff.
                        extra += ["--accomp-audio", str(stems["other"])]
                else:
                    # Instrument-led paths: transcribe the melodic-instruments
                    # stem with that instrument's register prior.
                    pipeline_audio = stems.get("other", stems["vocals"])
                    separation = f"other→{instrument}"
                    extra += ["--part-name", spec["part"],
                              "--fmin", str(spec["fmin"]),
                              "--fmax", str(spec["fmax"])]
            except (NotationError, subprocess.TimeoutExpired, OSError) as exc:
                separation = f"failed; used full mix ({str(exc)[:200]})"
        elif spec is not None and not spec.get("crepe"):
            # No separation: still honour the register prior + staff name.
            extra += ["--part-name", spec["part"],
                      "--fmin", str(spec["fmin"]), "--fmax", str(spec["fmax"])]

        # --melody: the public notation surface always wants ONE readable
        # line, not the raw polyphonic detection soup (research keeps both).
        _stage(job_id, "transcribing notes and engraving the score")
        t0 = time.time()
        cmd = [settings.transcribe_python, "-m", "scripts.transcribe",
               str(pipeline_audio), str(job_dir(job_id)), "--melody", *extra]
        if pipeline_audio is not audio:
            # Notes from the vocal stem, beats from the full mix — percussion
            # carries the pulse the isolated voice floats over.
            cmd += ["--beat-audio", str(audio)]
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              timeout=_TRANSCRIBE_TIMEOUT_S,
                              cwd=Path(__file__).resolve().parents[1])
        timings["transcribe"] = round(time.time() - t0, 1)
        if proc.returncode != 0:
            raise NotationError(proc.stderr.strip()[-800:] or "transcription failed")
        result = json.loads(
            (job_dir(job_id) / f"{pipeline_audio.stem}.json").read_text())
        # Artifacts are named after the file the pipeline actually ran on
        # (vocals.* when separated) — remember that stem for artifact_path.
        done = {**state, "artifact_stem": pipeline_audio.stem,
                "timings": timings, "stage": "done"}
        if separation is not None:
            done["separation"] = separation
        if "error" in result:
            _write(job_id, {**done, "status": "error", "error": result["error"]})
        else:
            _write(job_id, {**done, "status": "done", "result": result})
    except (NotationError, subprocess.TimeoutExpired, OSError,
            json.JSONDecodeError, FileNotFoundError) as exc:
        _write(job_id, {**state, "status": "error", "error": str(exc)[:800]})
    finally:
        if acquired:
            _heavy.release()
        if job_id in _waiting:
            _waiting.remove(job_id)
        _running.discard(job_id)


def read_job(job_id: str) -> dict:
    f = job_dir(job_id) / "job.json"
    if not f.exists():
        raise NotationError("unknown job id")
    state = json.loads(f.read_text())
    # a 'processing' job that is not actually running died with the process
    if state["status"] == "processing" and job_id not in _running:
        state["status"] = "error"
        state["error"] = "service restarted mid-job; re-upload to retry"
    return state


def artifact_path(job_id: str, kind: str) -> Path:
    if kind == "original":
        # The uploaded recording itself — served for A/B listening against
        # the transcription. Available regardless of job status.
        state = read_job(job_id)
        p = job_dir(job_id) / state["input"]
        if not p.exists():
            raise NotationError("original audio missing")
        return p
    ext = {"musicxml": ".musicxml", "svg": ".svg", "midi": ".mid"}.get(kind)
    if ext is None:
        raise NotationError(f"unknown artifact kind '{kind}'")
    state = read_job(job_id)
    if state["status"] != "done":
        raise NotationError(f"job is {state['status']}, artifacts not ready")
    # Separated jobs transcribe the vocals stem, so artifacts carry its stem.
    stem = state.get("artifact_stem") or Path(state["input"]).stem
    p = job_dir(job_id) / f"{stem}{ext}"
    if not p.exists():
        raise NotationError(f"artifact {kind} missing")
    return p


def _write(job_id: str, state: dict) -> None:
    (job_dir(job_id) / "job.json").write_text(json.dumps(state, indent=1))
