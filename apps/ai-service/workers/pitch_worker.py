"""Celery pitch-extraction task (SESSION P3-02, ARCHITECTURE.md §8 job queue).

Task binding only — broker, retry envelope, and failure escalation are the
shared policy in workers/celery_app.py, identical for every AI stage.

Run the worker (serves all stages):  celery -A workers.celery_app worker
"""

from __future__ import annotations

from services.pitch_service import run_pitch_job
from workers.celery_app import celery_app, execute_job


@celery_app.task(name="pitch.process", bind=True, max_retries=3)
def process_pitch(
    self: object,
    job_id: str,
    recording_id: str,
    audio_url: str,
) -> dict[str, str]:
    """Process one pitch-extraction job under the shared retry/escalation policy."""
    return execute_job(
        self,
        job_id,
        recording_id,
        lambda: run_pitch_job(job_id, recording_id, audio_url),
        stage="pitch",
    )
