"""CREPE pitch extraction + Somali scale mapping (ARCHITECTURE.md §10).

The heavy libraries (crepe, librosa, torch) are imported LAZILY inside the task so
that importing this router — and running the pure scale-mapping unit tests — does
not require the ML stack. The scale mapping itself lives in services.scale.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends

from config import get_settings
from deps import require_internal_key
from schemas import JobAccepted, PitchRequest
from services.audio import download_audio, post_result
from services.scale import map_pitch_frames

router = APIRouter(prefix="/pitch", tags=["pitch"], dependencies=[Depends(require_internal_key)])


@router.post("/extract", response_model=JobAccepted)
async def extract_pitch(req: PitchRequest, tasks: BackgroundTasks) -> JobAccepted:
    tasks.add_task(_run_pitch_extraction, req)
    return JobAccepted(recording_id=req.recording_id)


async def _run_pitch_extraction(req: PitchRequest) -> None:
    # Lazy imports: keep the ML deps out of the import graph for tests/CI.
    import crepe  # type: ignore[import-untyped]
    import librosa

    settings = get_settings()
    audio_path = await download_audio(req.audio_url, req.recording_id)

    # CREPE requires 16 kHz mono.
    audio, sr = librosa.load(str(audio_path), sr=16000, mono=True)
    time, frequency, confidence, _ = crepe.predict(
        audio,
        sr,
        model_capacity="full",
        viterbi=True,
        step_size=10,
        verbose=0,
    )

    frames = [
        (float(t), float(hz), float(conf))
        for t, hz, conf in zip(time, frequency, confidence)
    ]
    pitch_data = map_pitch_frames(frames, settings.pitch_confidence_threshold)
    await post_result(req.recording_id, {"pitch_data": pitch_data})
