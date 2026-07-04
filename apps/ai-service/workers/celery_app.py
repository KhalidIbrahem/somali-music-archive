"""Shared Celery application for all AI pipeline stages (ARCHITECTURE.md §8).

Run one worker process serving every stage:

    celery -A workers.celery_app worker --loglevel=info

WHY one app rather than per-stage apps: every stage (transcribe, pitch, embed)
shares the same broker, the same retry envelope (3 attempts, exponential
backoff, 10-minute hard cap), the same permanent-failure semantics for invalid
audio, and the same Sentry escalation. Stage modules contribute TASKS; the
infrastructure lives here once. The ``include`` list registers the task modules
when the worker boots.

Retry policy rationale (per §8): transient failures (network, R2 hiccup, model
OOM under load) deserve 30 s → 60 s → 120 s backoff; validation failures are
PERMANENT — retrying a file that is not audio burns GPU-hours for nothing — so
they reject immediately with no retry. A final failure is escalated because a
silently dropped recording is an archival loss, not a blip.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from celery import Celery

from config import get_settings
from services.embedding_service import EmbeddingValidationError
from utils.audio_download import AudioValidationError

logger = logging.getLogger("ai.worker")

# Failures that no amount of retrying can fix: bad input audio, or a
# deterministically corrupt model output. Rejected immediately, no GPU wasted.
PERMANENT_ERRORS: tuple[type[Exception], ...] = (AudioValidationError, EmbeddingValidationError)

_settings = get_settings()

celery_app = Celery(
    "sma-ai-service",
    broker=_settings.celery_broker_url,
    include=[
        "workers.transcription_worker",
        "workers.pitch_worker",
        "workers.embedding_worker",
    ],
)
celery_app.conf.update(
    task_time_limit=600,  # 10-minute hard cap per attempt
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


def report_failure(exc: Exception, job_id: str, recording_id: str, stage: str) -> None:
    """Final-failure escalation: Sentry when available, ERROR log always."""
    logger.error(
        "%s FAILED permanently job_id=%s recording_id=%s error=%s",
        stage,
        job_id,
        recording_id,
        exc,
    )
    try:
        import sentry_sdk

        sentry_sdk.capture_exception(exc)
    except ImportError:
        pass  # already logged above


def execute_job(
    task: Any,
    job_id: str,
    recording_id: str,
    runner: Callable[[], None],
    *,
    stage: str,
) -> dict[str, str]:
    """Run one job under the shared retry/reject/escalate policy.

    ``task`` is the bound Celery task (for retry bookkeeping); ``runner`` is the
    stage's zero-arg pipeline call. Keeping the policy here means a new stage
    cannot accidentally ship with weaker failure handling.
    """
    try:
        runner()
    except PERMANENT_ERRORS as exc:
        # Permanent problem (bad format/duration, corrupt model output):
        # retrying cannot fix it, so reject without burning GPU time.
        report_failure(exc, job_id, recording_id, stage)
        return {"status": "rejected", "job_id": job_id, "reason": str(exc)}
    except Exception as exc:
        if task.request.retries >= task.max_retries:
            report_failure(exc, job_id, recording_id, stage)
            raise
        countdown = 30 * (2**task.request.retries)  # 30s, 60s, 120s
        logger.warning(
            "%s retry %d/%d in %ds job_id=%s error=%s",
            stage,
            task.request.retries + 1,
            task.max_retries,
            countdown,
            job_id,
            exc,
        )
        raise task.retry(exc=exc, countdown=countdown) from exc
    return {"status": "complete", "job_id": job_id}
