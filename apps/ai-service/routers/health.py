"""Health check — public, unauthenticated (ARCHITECTURE.md §13)."""

from __future__ import annotations

from fastapi import APIRouter

from schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse()
