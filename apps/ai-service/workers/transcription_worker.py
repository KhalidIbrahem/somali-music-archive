"""Celery transcription worker (SESSION P3-01, ARCHITECTURE.md §8 job queue).

Run with:  celery -A workers.transcription_worker worker --loglevel=info

WHY Celery here but not in dev: transcription of a 10-minute recording is
minutes of GPU/CPU time — it must survive API restarts and scale to multiple
worker machines (§14). Development, though, should not require Redis, so the
router falls back to FastAPI BackgroundTasks when USE_CELERY=false; both paths
execute the identical ``run_transcription_job`` so behaviour never diverges.

Retry policy (per the session spec):
  * 3 retries, exponential backoff (30 s → 60 s → 120 s),
  * 10-minute hard time limit per attempt,
  * validation failures (bad format/duration) are PERMANENT — retrying a file
    that is not audio wastes GPU-hours, so they fail fast with no retry,
  * the final failure is reported to Sentry (or logged when Sentry is absent)
    because a silently dropped recording is an archival loss, not a blip.

This module is only imported where Celery is actually used (worker process, or
the router when USE_CELERY=true), keeping the dev/test import graph light.
"""

from __future__ import annotations

import logging
from typing import Any

from celery import Celery

from config import get_settings
from services.transcription_service import run_transcription_job
from utils.audio_download import AudioValidationError

logger = logging.getLogger("ai.worker")

_settings = get_settings()

celery_app = Celery("sma-ai-service", broker=_settings.celery_broker_url)
celery_app.conf.update(
    task_time_limit=600,  # 10-minute hard cap per attempt (session spec)
    task_soft_time_limit=570,  # soft limit first, so cleanup handlers can run
    task_acks_late=True,  # a killed worker re-queues the job instead of losing it
    worker_prefetch_multiplier=1,  # long jobs: never hoard queue items
    broker_connection_retry_on_startup=True,
)


def _init_sentry() -> None:
    """Attach Sentry when configured; degrade to logging when the SDK is absent."""
    if not _settings.sentry_dsn:
        return
    try:
        import sentry_sdk

        sentry_sdk.init(dsn=_settings.sentry_dsn, environment=_settings.ai_env)
    except ImportError:
        logger.warning("SENTRY_DSN set but sentry-sdk not installed; failures log only")


_init_sentry()


def _report_failure(exc: Exception, job_id: str, recording_id: str) -> None:
    """Final-failure escalation: Sentry when available, ERROR log always."""
    logger.error(
        "transcription FAILED permanently job_id=%s recording_id=%s error=%s",
        job_id,
        recording_id,
        exc,
    )
    try:
        import sentry_sdk

        sentry_sdk.capture_exception(exc)
    except ImportError:
        pass  # already logged above


@celery_app.task(name="transcribe.process", bind=True, max_retries=3)
def process_transcription(
    self: Any,
    job_id: str,
    recording_id: str,
    audio_url: str,
    language: str = "so",
) -> dict[str, str]:
    """Process one transcription job with retry/backoff and failure escalation."""
    try:
        run_transcription_job(job_id, recording_id, audio_url, language)
    except AudioValidationError as exc:
        # Permanent input problem: retrying cannot fix a wrong format/duration.
        _report_failure(exc, job_id, recording_id)
        return {"status": "rejected", "job_id": job_id, "reason": str(exc)}
    except Exception as exc:
        if self.request.retries >= self.max_retries:
            _report_failure(exc, job_id, recording_id)
            raise
        countdown = 30 * (2**self.request.retries)  # 30s, 60s, 120s
        logger.warning(
            "transcription retry %d/%d in %ds job_id=%s error=%s",
            self.request.retries + 1,
            self.max_retries,
            countdown,
            job_id,
            exc,
        )
        raise self.retry(exc=exc, countdown=countdown) from exc
    return {"status": "complete", "job_id": job_id}
