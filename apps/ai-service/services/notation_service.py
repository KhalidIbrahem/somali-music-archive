"""Sheet-music notation jobs (Phase 5 Track B surface).

A job = one uploaded audio file transcribed to MusicXML/SVG/MIDI with the
pentatonic-aware pipeline. Transcription runs in the somali311 Python (basic-pitch
needs <=3.11) as a subprocess — the service process never imports TF/ONNX.

Job state lives on disk (data/notation_jobs/<id>/job.json), so a service restart
loses nothing; an in-process set tracks which jobs are actively running.
"""

from __future__ import annotations

import json
import subprocess
import time
import uuid
from pathlib import Path

from config import get_settings

JOBS_ROOT = Path(__file__).resolve().parents[1] / "data" / "notation_jobs"
ALLOWED_SUFFIXES = {".wav", ".mp3", ".m4a", ".flac", ".ogg"}
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
_TRANSCRIBE_TIMEOUT_S = 600

_running: set[str] = set()


class NotationError(Exception):
    pass


def job_dir(job_id: str) -> Path:
    d = JOBS_ROOT / job_id
    if not d.resolve().is_relative_to(JOBS_ROOT.resolve()):
        raise NotationError("invalid job id")
    return d


def create_job(filename: str, payload: bytes) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise NotationError(f"unsupported audio format {suffix or '(none)'}; "
                            f"use one of {sorted(ALLOWED_SUFFIXES)}")
    if len(payload) > MAX_UPLOAD_BYTES:
        raise NotationError("file exceeds 50 MB limit")
    if not payload:
        raise NotationError("empty upload")
    job_id = uuid.uuid4().hex
    d = job_dir(job_id)
    d.mkdir(parents=True)
    (d / f"input{suffix}").write_bytes(payload)
    _write(job_id, {"job_id": job_id, "status": "pending",
                    "created_at": time.time(), "input": f"input{suffix}"})
    return job_id


def run_job(job_id: str) -> None:
    """Synchronous pipeline body — invoked on a background thread (or Celery)."""
    state = read_job(job_id)
    audio = job_dir(job_id) / state["input"]
    _running.add(job_id)
    _write(job_id, {**state, "status": "processing"})
    settings = get_settings()
    cmd = [settings.transcribe_python, "-m", "scripts.transcribe",
           str(audio), str(job_dir(job_id))]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              timeout=_TRANSCRIBE_TIMEOUT_S,
                              cwd=Path(__file__).resolve().parents[1])
        if proc.returncode != 0:
            raise NotationError(proc.stderr.strip()[-800:] or "transcription failed")
        result = json.loads((job_dir(job_id) / f"{audio.stem}.json").read_text())
        if "error" in result:
            _write(job_id, {**state, "status": "error", "error": result["error"]})
        else:
            _write(job_id, {**state, "status": "done", "result": result})
    except (NotationError, subprocess.TimeoutExpired, OSError,
            json.JSONDecodeError, FileNotFoundError) as exc:
        _write(job_id, {**state, "status": "error", "error": str(exc)[:800]})
    finally:
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
    ext = {"musicxml": ".musicxml", "svg": ".svg", "midi": ".mid"}.get(kind)
    if ext is None:
        raise NotationError(f"unknown artifact kind '{kind}'")
    state = read_job(job_id)
    if state["status"] != "done":
        raise NotationError(f"job is {state['status']}, artifacts not ready")
    stem = Path(state["input"]).stem
    p = job_dir(job_id) / f"{stem}{ext}"
    if not p.exists():
        raise NotationError(f"artifact {kind} missing")
    return p


def _write(job_id: str, state: dict) -> None:
    (job_dir(job_id) / "job.json").write_text(json.dumps(state, indent=1))
