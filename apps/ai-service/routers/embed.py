"""MERT embedding endpoint (SESSION P3-03, ARCHITECTURE.md §10 Job 4).

POST /embed accepts {recording_id, audio_url} and returns a job_id immediately —
MERT inference over a whole recording is heavy compute. Only cheap fail-fast
URL-format validation happens inline (422). Dispatch is dual-mode like every AI
stage: Celery when USE_CELERY=true, otherwise the same sync pipeline on
Starlette's thread pool.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from config import get_settings
from deps import require_internal_key
from schemas import EmbedRequest, JobAccepted
from services.embedding_service import run_embedding_job
from utils.audio_download import AudioValidationError, validate_format

router = APIRouter(prefix="/embed", tags=["embed"], dependencies=[Depends(require_internal_key)])


@router.post("", response_model=JobAccepted)
async def embed(req: EmbedRequest, tasks: BackgroundTasks) -> JobAccepted:
    """Queue an embedding job; returns {status, recording_id, job_id} at once."""
    try:
        validate_format(req.audio_url)
    except AudioValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    job_id = uuid.uuid4().hex
    settings = get_settings()

    if settings.use_celery:
        # Lazy import: Celery/Redis exist only in deployed environments.
        from workers.celery_app import celery_app

        celery_app.send_task("embed.process", args=[job_id, req.recording_id, req.audio_url])
    else:
        # Sync pipeline → Starlette runs it in a worker thread; event loop stays free.
        tasks.add_task(run_embedding_job, job_id, req.recording_id, req.audio_url)

    return JobAccepted(recording_id=req.recording_id, job_id=job_id)
