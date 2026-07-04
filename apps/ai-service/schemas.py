"""Pydantic request/response models for the AI service (ARCHITECTURE.md §10).

These mirror the fields the Node API expects back on the recording's `ai` object
(§9). Keeping them here documents the contract between the two services in one place.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class TranscribeRequest(BaseModel):
    recording_id: str
    audio_url: str  # short-lived presigned R2 URL
    language: str = "so"  # Somali by default


class PitchRequest(BaseModel):
    recording_id: str
    audio_url: str


class EmbedRequest(BaseModel):
    recording_id: str
    audio_url: str


class JobAccepted(BaseModel):
    status: str = "queued"
    recording_id: str
    # Correlation id for the async job; empty for legacy endpoints that predate it.
    job_id: str = ""


class PitchPoint(BaseModel):
    time_sec: float
    frequency_hz: float
    confidence: float
    note_label: str
    cents_deviation: float = Field(
        description="Deviation from equal temperament in cents — the microtonality signal.",
    )


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "ai-service"
