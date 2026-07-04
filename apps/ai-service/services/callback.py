"""Internal result callback to the Node API (ARCHITECTURE.md §10 pipeline).

Every AI stage (transcription, pitch, embeddings) delivers its result the same
way: a POST to the Node API's internal endpoint, authenticated with the shared
service key. Centralised here so the wire contract — URL shape, `kind`
discriminator, correlation `job_id` — exists in exactly one place.

WHY raise on non-2xx instead of logging-and-continuing: a result that fails to
deliver after minutes of GPU time is an archival loss, not a blip. Raising lets
the worker's retry/backoff policy treat failed delivery like any other
transient failure and try again.

Module-level imports are stdlib-only (Phase-0 convention); httpx and settings
load lazily at call time.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any

logger = logging.getLogger("ai.callback")


def post_ai_result(
    job_id: str,
    recording_id: str,
    kind: str,
    payload: Mapping[str, Any],
) -> None:
    """POST one stage's finished result to the internal recordings endpoint."""
    import httpx

    from config import get_settings

    settings = get_settings()
    url = f"{settings.callback_api_url}/internal/recordings/{recording_id}/ai"
    body = {"job_id": job_id, "kind": kind, **payload}
    headers = {"x-internal-key": settings.ai_service_api_key}

    with httpx.Client(timeout=30.0) as client:
        response = client.post(url, json=body, headers=headers)
        response.raise_for_status()
    logger.info("result delivered kind=%s recording_id=%s job_id=%s", kind, recording_id, job_id)
