"""The listening review page, for musicians who do not read notation. Served
from this local service only; see services/review_service.py for what it does
with a recording.

GET  /demo/review                                  every transcribed recording on disk
GET  /demo/review/{slug}                           the page (static/review.html)
GET  /demo/review/{slug}/phrases                   phrase windows, bar numbers, times
GET  /demo/review/{slug}/phrase/{i}/original.wav   that window of the recording
GET  /demo/review/{slug}/phrase/{i}/machine.wav    the score's notes in that window
GET  /demo/review/{slug}/{annotator}/state         what this listener has saved
POST /demo/review/{slug}/{annotator}/phrase/{i}    verdict and/or note, saved at once
POST /demo/review/{slug}/{annotator}/phrase/{i}/recording   their own version (multipart)
GET  /demo/review/{slug}/{annotator}/recording/{name}
GET  /demo/review/{slug}/{annotator}/export.md     the phrases marked wrong, for MuseScore
"""
from __future__ import annotations

import asyncio
import html
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, Response
from pydantic import BaseModel, Field

from config import get_settings
from services import review_service as rs

router = APIRouter(prefix="/demo/review", tags=["demo"])
PAGE = Path(__file__).resolve().parents[1] / "static" / "review.html"


class PhraseBody(BaseModel):
    verdict: str | None = Field(default=None, max_length=20)
    note: str | None = Field(default=None, max_length=2000)


def _item(slug: str) -> rs.Item:
    try:
        return rs.resolve(slug)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"no transcribed recording called {slug!r}") from None


def _annotator(name: str) -> str:
    if not rs.ANNOTATOR_RE.fullmatch(name):
        raise HTTPException(status_code=400, detail="annotator names use a-z, 0-9, _ and - only")
    return name


def _phrase(it: rs.Item, index: int) -> tuple[dict, rs.Phrase]:
    pipeline = rs.load_pipeline(it)
    phrases = rs.split_phrases(pipeline)
    if not 0 <= index < len(phrases):
        raise HTTPException(status_code=404, detail=f"phrase {index} is out of range (0-{len(phrases) - 1})")
    return pipeline, phrases[index]


@router.get("", response_class=HTMLResponse)
async def index() -> str:
    items = rs.list_items()
    headings = {"pack": "Benchmark packs", "pool": "Every recording in the transcription pool", "demo": "Demo recordings"}

    def li(p: dict) -> str:
        dur = f" · {_mmss(p['duration_s'])}" if p.get("duration_s") else ""
        old = "" if p.get("legato") else " · transcribed before the legato fix"
        rev = (" · reviewed by " + ", ".join(p["reviews"])) if p["reviews"] else ""
        return (f'<li><a href="/demo/review/{html.escape(p["slug"])}">{html.escape(p["title"])}</a>'
                f'<span class="meta">{html.escape(p["source"] or "")}{dur}{old}{rev}</span></li>')

    sections = []
    for kind in ("pack", "pool", "demo"):
        rows = [li(p) for p in items if p["kind"] == kind]
        if rows:
            sections.append(f"<h2>{headings[kind]} ({len(rows)})</h2><ul>{''.join(rows)}</ul>")
    body = "".join(sections) or "<p>No transcribed recordings found under data/.</p>"
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Listening review</title>
<style>body{{font:22px/1.5 -apple-system,"Helvetica Neue",Arial,sans-serif;color:#1a1a1a;background:#fafaf7;margin:0;padding:28px}}
h1{{font-size:30px;margin:0 0 6px}} h2{{font-size:22px;margin:28px 0 6px;color:#333}} p{{color:#555;margin:0 0 20px}} ul{{list-style:none;padding:0;margin:0}}
li{{padding:14px 0;border-bottom:1px solid #e6e2da}} a{{color:#24507a;font-weight:600;text-decoration:none}}
.meta{{display:block;font-size:17px;color:#666}}</style></head>
<body><h1>Listening review</h1>
<p>Pick a recording. You will hear it a few bars at a time, next to what the machine wrote down, and say whether the machine got it right. Recordings marked "before the legato fix" were transcribed with the older note segmentation and can sound choppy in the machine version.</p>
{body}</body></html>"""


def _mmss(seconds: float) -> str:
    m, s = divmod(int(round(seconds)), 60)
    return f"{m}:{s:02d}"


@router.get("/{slug}", response_class=HTMLResponse)
async def page(slug: str) -> str:
    _item(slug)
    return PAGE.read_text()


@router.get("/{slug}/phrases")
async def phrases(slug: str) -> dict:
    it = _item(slug)
    payload = rs.phrases_payload(it, rs.load_pipeline(it))
    payload["https_url"] = get_settings().review_https_url
    return payload


@router.get("/{slug}/phrase/{index}/original.wav")
async def original(slug: str, index: int) -> Response:
    it = _item(slug)
    pipeline, ph = _phrase(it, index)
    data = await asyncio.to_thread(rs.cached_audio, it, ph, "original", pipeline)
    return Response(content=data, media_type="audio/wav", headers={"cache-control": "no-store"})


@router.get("/{slug}/phrase/{index}/machine.wav")
async def machine(slug: str, index: int) -> Response:
    it = _item(slug)
    pipeline, ph = _phrase(it, index)
    data = await asyncio.to_thread(rs.cached_audio, it, ph, "machine", pipeline)
    return Response(content=data, media_type="audio/wav", headers={"cache-control": "no-store"})


@router.get("/{slug}/{annotator}/state")
async def state(slug: str, annotator: str) -> dict:
    it = _item(slug)
    return rs.load_review(it, _annotator(annotator))


@router.post("/{slug}/{annotator}/phrase/{index}")
async def save(slug: str, annotator: str, index: int, body: PhraseBody) -> dict:
    it = _item(slug)
    who = _annotator(annotator)
    _, ph = _phrase(it, index)
    try:
        rev = rs.save_phrase(it, who, ph, verdict=body.verdict, note=body.note)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"saved": rev["phrases"][str(index)], "updated": rev["updated"]}


@router.post("/{slug}/{annotator}/phrase/{index}/recording")
async def upload_recording(slug: str, annotator: str, index: int, file: UploadFile = File(...)) -> dict:
    it = _item(slug)
    who = _annotator(annotator)
    _, ph = _phrase(it, index)
    data = await file.read()
    try:
        name = rs.save_recording(it, who, ph, data, file.content_type or "")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"recording": name, "url": f"/demo/review/{slug}/{who}/recording/{name}"}


@router.get("/{slug}/{annotator}/recording/{name}")
async def recording(slug: str, annotator: str, name: str) -> FileResponse:
    it = _item(slug)
    try:
        p = rs.recording_file(it, _annotator(annotator), name)
    except KeyError:
        raise HTTPException(status_code=404, detail="no such recording") from None
    return FileResponse(p)


@router.get("/{slug}/{annotator}/export.md", response_class=PlainTextResponse)
async def export(slug: str, annotator: str) -> str:
    it = _item(slug)
    return rs.export_markdown(it, _annotator(annotator))
