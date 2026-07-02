"""Whisper speech transcription (ARCHITECTURE.md §10).

Transcribes Somali audio and produces an English translation. Whisper is loaded
lazily and cached in models.registry so this router imports without the model
present. Both passes (transcribe + translate) run in a background task.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends

from deps import require_internal_key
from schemas import JobAccepted, TranscribeRequest
from services.audio import download_audio, post_result

router = APIRouter(
    prefix="/transcribe",
    tags=["transcribe"],
    dependencies=[Depends(require_internal_key)],
)


@router.post("", response_model=JobAccepted)
async def transcribe(req: TranscribeRequest, tasks: BackgroundTasks) -> JobAccepted:
    tasks.add_task(_run_transcription, req)
    return JobAccepted(recording_id=req.recording_id)


async def _run_transcription(req: TranscribeRequest) -> None:
    from models.registry import get_whisper

    model = get_whisper()
    audio_path = await download_audio(req.audio_url, req.recording_id)

    original = model.transcribe(
        str(audio_path),
        language=req.language,
        task="transcribe",
        word_timestamps=True,
        verbose=False,
    )
    english = model.transcribe(
        str(audio_path),
        language=req.language,
        task="translate",
        verbose=False,
    )

    await post_result(
        req.recording_id,
        {
            "transcript_somali": original["text"],
            "transcript_english": english["text"],
            "detected_language": original.get("language", req.language),
        },
    )
