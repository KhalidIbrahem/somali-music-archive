"""The local demo page: one plain HTML file, no framework, no build step.

GET  /demo            the page (static/demo.html)
GET  /demo/config     is the MusicGen service up, which adapters it serves
POST /demo/generate   text prompt -> generation, proxied to the MusicGen service
GET  /demo/audio/{id} the generated wav, proxied with the service's token

Transcription itself goes through the existing /notation endpoints.
"""
from __future__ import annotations

import asyncio
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field

from services import musicgen_client

router = APIRouter(prefix="/demo", tags=["demo"])
PAGE = Path(__file__).resolve().parents[1] / "static" / "demo.html"


class GenerateBody(BaseModel):
    prompt: str = Field(min_length=3, max_length=400)
    adapter: str = Field(default="oud", max_length=40)
    duration: int = Field(default=10, ge=3, le=30)
    seed: int = Field(default=42, ge=0, le=2**31 - 1)


@router.get("", response_class=HTMLResponse)
async def page() -> str:
    return PAGE.read_text()


@router.get("/config")
async def config() -> dict:
    return {"generation": await asyncio.to_thread(musicgen_client.status)}


@router.post("/generate")
async def generate(body: GenerateBody) -> dict:
    try:
        meta = await asyncio.to_thread(musicgen_client.generate, body.prompt, body.adapter,
                                       body.duration, body.seed)
    except Exception as exc:  # noqa: BLE001 - surface the service's answer, not a 500
        raise HTTPException(status_code=502, detail=f"generation service: {str(exc)[:300]}") from exc
    meta["audio"] = f"/demo/audio/{meta['id']}"
    return meta


@router.get("/audio/{gen_id}")
async def audio(gen_id: str) -> Response:
    if not re.fullmatch(r"[0-9a-f]{8,32}", gen_id):
        raise HTTPException(status_code=404, detail="no such generation")
    try:
        data = await asyncio.to_thread(musicgen_client.audio, gen_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"generation service: {str(exc)[:300]}") from exc
    return Response(content=data, media_type="audio/wav")
