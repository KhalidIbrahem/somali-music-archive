"""Public sheet-music transcription endpoints (Phase 5, Track B).

Unlike the internal Whisper /transcribe router (Node-API-to-service, keyed),
these endpoints serve the public web app directly: browser uploads a file,
polls the job, then fetches artifacts. Validation is therefore strict here
(format allowlist + size cap) instead of key-gated.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile
from fastapi.responses import FileResponse

from services import notation_service as svc

router = APIRouter(prefix="/notation", tags=["notation"])

_MEDIA_TYPES = {
    "musicxml": "application/vnd.recordare.musicxml+xml",
    "svg": "image/svg+xml",
    "midi": "audio/midi",
}


@router.post("", status_code=202)
async def create(file: UploadFile, tasks: BackgroundTasks) -> dict:
    payload = await file.read()
    try:
        job_id = svc.create_job(file.filename or "upload.wav", payload)
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
    return FileResponse(path, media_type=_MEDIA_TYPES[kind], filename=path.name)
