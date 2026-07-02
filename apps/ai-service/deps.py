"""Shared FastAPI dependencies (ARCHITECTURE.md §11).

The AI service is INTERNAL — only the Node API should reach it. Every analysis
endpoint requires the shared internal key. This is defence in depth alongside
network isolation (the service is not publicly routable in production).
"""

from __future__ import annotations

from fastapi import Header, HTTPException, status

from config import get_settings


def require_internal_key(x_internal_key: str = Header(default="")) -> None:
    """Reject any request without the correct internal service key."""
    settings = get_settings()
    if x_internal_key != settings.ai_service_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal service key",
        )
