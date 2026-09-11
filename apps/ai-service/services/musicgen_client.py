"""Server-side client for the local MusicGen inference service
(services/musicgen-api). The demo page never sees the bearer token: it is
read here from the service's own env file and sent from this process."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import httpx

from config import get_settings


def _token() -> str:
    s = get_settings()
    if s.musicgen_api_token:
        return s.musicgen_api_token
    env_file = Path(os.path.expanduser(s.musicgen_api_env_file))
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("MUSICGEN_API_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"')
    return ""


def _base() -> str:
    return get_settings().musicgen_api_url.rstrip("/")


def status() -> dict[str, Any]:
    """{'available': bool, 'adapters': [...], 'base_model': ..., 'detail': ...}."""
    try:
        r = httpx.get(f"{_base()}/health", timeout=3.0)
        r.raise_for_status()
        h = r.json()
        return {"available": True, "adapters": ["base", *h.get("adapters_loaded", [])],
                "base_model": h.get("base_model"), "device": h.get("device"), "url": _base()}
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "adapters": [], "detail": str(exc)[:200], "url": _base()}


def generate(prompt: str, adapter: str, duration: int, seed: int) -> dict[str, Any]:
    r = httpx.post(f"{_base()}/generate", json={"prompt": prompt, "adapter": adapter,
                                                  "duration": duration, "seed": seed, "score": True},
                   headers={"Authorization": f"Bearer {_token()}"}, timeout=600.0)
    r.raise_for_status()
    return r.json()


def audio(gen_id: str) -> bytes:
    r = httpx.get(f"{_base()}/audio/{gen_id}", headers={"Authorization": f"Bearer {_token()}"},
                  timeout=60.0)
    r.raise_for_status()
    return r.content
