"""Music generation endpoint — present but explicitly GATED (Phase 5 spec).

The Phase 0 audit found license_status=unknown for every corpus file, so the
generation feature must not be publicly exposed. The endpoint exists so the
gating is a deliberate, visible decision rather than a missing feature, and
flipping GENERATION_ENABLED=true is the single switch once licensing clears.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from config import get_settings

router = APIRouter(prefix="/generate", tags=["generate"])


class GenerateRequest(BaseModel):
    caption: str = Field(min_length=3, max_length=500)
    seconds: int = Field(default=10, ge=1, le=30)


@router.post("")
async def generate(req: GenerateRequest) -> dict:
    if not get_settings().generation_enabled:
        raise HTTPException(
            status_code=403,
            detail="Generation is disabled: the Phase 0 corpus audit recorded "
                   "license_status=unknown for all source recordings, so "
                   "generation is not publicly exposed. Set GENERATION_ENABLED=true "
                   "only once licensing is resolved.",
        )
    # Deliberately unimplemented while the gate is closed: the fine-tuned
    # checkpoints exist (runs/), but wiring them here before licensing clears
    # would make the flag the only safeguard against serving derived audio.
    raise HTTPException(status_code=501, detail="generation serving not implemented")
