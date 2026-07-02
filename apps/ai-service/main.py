"""FastAPI application entrypoint (ARCHITECTURE.md §10).

Run in development with:  uvicorn main:app --reload
The heavy models are NOT loaded at startup — they load lazily on first use
(models.registry), so the service boots instantly and the health check is cheap.
"""

from __future__ import annotations

from fastapi import FastAPI

from config import get_settings
from routers import embed, health, pitch, transcribe

settings = get_settings()

app = FastAPI(
    title="Somali Music AI Service",
    version="0.1.0",
    description="Transcription, pitch extraction, and audio embeddings for the archive.",
)

app.include_router(health.router)
app.include_router(transcribe.router)
app.include_router(pitch.router)
app.include_router(embed.router)


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "ai-service", "env": settings.ai_env}
