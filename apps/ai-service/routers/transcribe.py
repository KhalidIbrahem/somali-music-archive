"""Whisper transcription endpoint (SESSION P3-01, ARCHITECTURE.md §10 Job 2).

POST /transcribe accepts {recording_id, audio_url, language} and returns a
job_id IMMEDIATELY — transcription takes minutes, and holding the HTTP request
open that long would tie up the caller and time out proxies. The only work done
inline is cheap fail-fast validation of the audio URL's format, so obviously
bad requests get a 422 instead of a queued job that dies later.

Queueing is dual-mode (see workers/transcription_worker.py): Celery when
USE_CELERY=true, otherwise the same sync pipeline function on Starlette's
background thread pool — Celery is imported lazily so dev never needs it.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from config import get_settings
from deps import require_internal_key
from schemas import JobAccepted, TranscribeRequest
from services.transcription_service import run_transcription_job
from utils.audio_download import AudioValidationError, validate_format

router = APIRouter(
    prefix="/transcribe",
    tags=["transcribe"],
    dependencies=[Depends(require_internal_key)],
)


@router.post("", response_model=JobAccepted)
async def transcribe(req: TranscribeRequest, tasks: BackgroundTasks) -> JobAccepted:
    """Queue a transcription job; returns {status, recording_id, job_id} at once."""
    try:
        validate_format(req.audio_url)
    except AudioValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    job_id = uuid.uuid4().hex
    settings = get_settings()

    if settings.use_celery:
        # Lazy import: Celery/Redis exist only in deployed environments.
        from workers.celery_app import celery_app

        celery_app.send_task(
            "transcribe.process",
            args=[job_id, req.recording_id, req.audio_url, req.language],
        )
    else:
        # run_transcription_job is sync, so Starlette executes it in a worker
        # thread — the event loop (health checks, new requests) stays free.
        tasks.add_task(run_transcription_job, job_id, req.recording_id, req.audio_url, req.language)

    return JobAccepted(recording_id=req.recording_id, job_id=job_id)
