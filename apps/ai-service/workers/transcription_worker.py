"""Celery transcription task (SESSION P3-01, ARCHITECTURE.md §8 job queue).

The queue infrastructure — broker config, retry/backoff envelope, permanent
rejection of invalid audio, Sentry escalation — lives in workers/celery_app.py
and is shared by every AI stage. This module contributes only the task binding.

Run the worker (serves all stages):  celery -A workers.celery_app worker
"""

from __future__ import annotations

from services.transcription_service import run_transcription_job
from workers.celery_app import celery_app, execute_job


@celery_app.task(name="transcribe.process", bind=True, max_retries=3)
def process_transcription(
    self: object,
    job_id: str,
    recording_id: str,
    audio_url: str,
    language: str = "so",
) -> dict[str, str]:
    """Process one transcription job under the shared retry/escalation policy."""
    return execute_job(
        self,
        job_id,
        recording_id,
        lambda: run_transcription_job(job_id, recording_id, audio_url, language),
        stage="transcription",
    )
