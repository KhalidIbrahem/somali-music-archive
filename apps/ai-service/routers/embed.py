"""MERT audio embeddings for similarity search (ARCHITECTURE.md §10).

Generates a 768-dimensional embedding the Node API stores in pgvector (§9). Model
loaded lazily via models.registry.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends

from deps import require_internal_key
from schemas import EmbedRequest, JobAccepted
from services.audio import download_audio, post_result

router = APIRouter(prefix="/embed", tags=["embed"], dependencies=[Depends(require_internal_key)])


@router.post("", response_model=JobAccepted)
async def embed(req: EmbedRequest, tasks: BackgroundTasks) -> JobAccepted:
    tasks.add_task(_run_embedding, req)
    return JobAccepted(recording_id=req.recording_id)


async def _run_embedding(req: EmbedRequest) -> None:
    from models.registry import generate_embedding

    audio_path = await download_audio(req.audio_url, req.recording_id)
    embedding = generate_embedding(str(audio_path))
    await post_result(
        req.recording_id,
        {"embedding": embedding, "model_version": "mert-v1-95m"},
    )
