"""Public sheet-music transcription endpoints (Phase 5, Track B).

Unlike the internal Whisper /transcribe router (Node-API-to-service, keyed),
these endpoints serve the public web app directly: browser uploads a file,
polls the job, then fetches artifacts. Validation is therefore strict here
(format allowlist + size cap) instead of key-gated.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from services import notation_service as svc

router = APIRouter(prefix="/notation", tags=["notation"])

_MEDIA_TYPES = {
    "musicxml": "application/vnd.recordare.musicxml+xml",
    "svg": "image/svg+xml",
    "midi": "audio/midi",
}
# The original upload's type follows its suffix (kind == "original").
_AUDIO_TYPES = {
    ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
    ".flac": "audio/flac", ".ogg": "audio/ogg",
}


@router.post("", status_code=202)
async def create(
    file: UploadFile,
    tasks: BackgroundTasks,
    separate: bool = Form(default=False),
    instrument: str = Form(default="full"),
) -> dict:
    """`separate=true` runs Demucs source separation before transcription —
    slower, but markedly more accurate on band recordings. `instrument`
    chooses what to transcribe: full | voice | kaban | violin | flute."""
    payload = await file.read()
    try:
        job_id = svc.create_job(file.filename or "upload.wav", payload,
                                separate=separate, instrument=instrument)
    except svc.NotationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    tasks.add_task(svc.run_job, job_id)
    return {"job_id": job_id, "status": "pending"}


@router.get("/jobs/{job_id}")
async def status(job_id: str) -> dict:
    try:
        return svc.read_job(job_id)
    except svc.NotationError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/jobs/{job_id}/artifacts/{kind}")
async def artifact(job_id: str, kind: str) -> FileResponse:
    try:
        path = svc.artifact_path(job_id, kind)
    except svc.NotationError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    media = (_AUDIO_TYPES.get(path.suffix.lower(), "application/octet-stream")
             if kind == "original" else _MEDIA_TYPES[kind])
    return FileResponse(path, media_type=media, filename=path.name)
