"""Audio IO helpers (ARCHITECTURE.md §10).

Downloads a recording from its short-lived presigned R2 URL to a temp file for
processing, and posts analysis results back to the Node API. Model inference itself
lives in the router/model modules; this is the plumbing around it.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import httpx

from config import get_settings


async def download_audio(audio_url: str, recording_id: str) -> Path:
    """Stream the audio at ``audio_url`` to a temp file and return its path."""
    suffix = Path(audio_url.split("?", 1)[0]).suffix or ".audio"
    tmp = tempfile.NamedTemporaryFile(prefix=f"{recording_id}_", suffix=suffix, delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()

    async with httpx.AsyncClient(timeout=60.0) as client:
        async with client.stream("GET", audio_url) as response:
            response.raise_for_status()
            with tmp_path.open("wb") as fh:
                async for chunk in response.aiter_bytes():
                    fh.write(chunk)
    return tmp_path


async def post_result(recording_id: str, payload: dict[str, object]) -> None:
    """POST completed analysis back to the Node API's internal callback endpoint."""
    settings = get_settings()
    url = f"{settings.callback_api_url}/internal/recordings/{recording_id}/ai"
    headers = {"x-internal-key": settings.ai_service_api_key}
    async with httpx.AsyncClient(timeout=30.0) as client:
        await client.post(url, json=payload, headers=headers)
