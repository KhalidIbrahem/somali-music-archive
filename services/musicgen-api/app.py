"""QaraamiGen inference service — MusicGen base models + LoRA adapters, served locally.
One engine per base model (small and large by default); each adapter belongs to one
base. The default engine loads before the API accepts requests, the others load in
the background and their adapters answer 503 until ready.

One process, one model on MPS, batch size 1 always. Adapters (oud, harvard_raw) are
loaded once and hot-swapped per request with PEFT's set_adapter; `base` runs with
adapters disabled. A single worker thread serialises generation and PCS scoring
(MPS is not safely re-entrant); at most QUEUE_MAX requests may wait.

Rights: every generation response carries a `provenance` statement naming the
adapter's training corpus and stating that source audio is not distributed. The
service never serves corpus audio — only its own generated clips.

Auth: Bearer token read from an env file OUTSIDE the repo (MUSICGEN_API_ENV_FILE,
default ~/ai/musicgen-api/musicgen-api.env). /health is unauthenticated (no data).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
AI_SERVICE = REPO / "apps/ai-service"
sys.path.insert(0, str(AI_SERVICE))  # scripts.pcs / scripts.pentatonic (the project's scorer)

from scripts.pcs import extract_f0, score_frames  # noqa: E402

# ── configuration ──────────────────────────────────────────────────────────────
ENV_FILE = Path(os.environ.get("MUSICGEN_API_ENV_FILE", Path.home() / "ai/musicgen-api/musicgen-api.env"))
if ENV_FILE.exists():
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"'))

TOKEN = os.environ.get("MUSICGEN_API_TOKEN", "")
# Base models to load, in order. The first is the default engine (its plain
# model is the "base" adapter). Override with MUSICGEN_ENGINES=a,b.
ENGINE_MODELS = [m.strip() for m in os.environ.get(
    "MUSICGEN_ENGINES", f"{os.environ.get('MUSICGEN_BASE_MODEL', 'facebook/musicgen-small')},facebook/musicgen-large"
).split(",") if m.strip()]
DEFAULT_BASE = ENGINE_MODELS[0]
BASE_MODEL = DEFAULT_BASE
SIZE_LABEL = {
    "facebook/musicgen-small": "Small 300M",
    "facebook/musicgen-medium": "Medium 1.5B",
    "facebook/musicgen-large": "Large 3.3B",
    "facebook/musicgen-melody": "Melody 1.5B",
}
OUTPUT_DIR = Path(os.environ.get("MUSICGEN_OUTPUT_DIR", HERE / "outputs"))
QUEUE_MAX = int(os.environ.get("MUSICGEN_QUEUE_MAX", "3"))
MAX_SECONDS = 30
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
BOS = 2048
STARTED = time.time()

ADAPTERS: dict[str, dict] = {
    "oud": {
        "path": REPO / "runs/oud_lora_r16_nodrop_20260809/ckpt_step_0500",
        "corpus": "the privately shared oud (kaban) qaraami collection — 28 songs, 1,921 fifteen-second clips",
        "trained": "2026-08-09, LoRA r=16 α=32 on decoder q/k/v/out, lr 1e-4 cosine, 1,000 steps, best checkpoint step 500",
        "metrics": {"val_ce": {"base": 4.5132, "adapter": 4.4785}, "test_ce": {"base": 2.6302, "adapter": 2.6092}},
        "listening_gate": "passed (Khalid, 2026-09)",
        "base": "facebook/musicgen-small",
    },
    "harvard_raw": {
        "path": REPO / "runs/harvard_raw_3000/ckpt_step_2750",
        "corpus": "the Maryan 'Aryette' Omar Ali Collection (Harvard Loeb Music Library, AWM Spec Coll 103) — 119 tracks, 11,386 fifteen-second clips, raw audio",
        "trained": "2026-09-03, LoRA r=16 α=32 on decoder q/k/v/out, lr 1e-4 cosine, 3,000 steps, best checkpoint step 2750",
        "metrics": {"val_ce": {"base": 4.6262, "adapter": 4.5501}, "test_ce": {"base": 4.8363, "adapter": 4.7468}},
        "listening_gate": "not yet performed",
        "base": "facebook/musicgen-small",
    },
    "large": {
        "path": REPO / "runs/qaraami_large_r32/ckpt_step_2750",
        "corpus": "the held qaraami corpus: the oud collection, the band recordings and the Harvard cassette collection — 43 h, 9,662 thirty-second clips",
        "trained": "2026-09-05, LoRA r=32 α=64 on decoder attention and feed-forward projections, lr 5e-5, 3,000 steps, best checkpoint step 2750",
        "metrics": {"val_ce": {"base": 4.4305, "adapter": 4.3245}, "test_ce": {"base": 4.0750, "adapter": 3.9469}},
        "listening_gate": "not yet performed",
        "base": "facebook/musicgen-large",
    },
}
RIGHTS_LINE = "Source recordings are not distributed and are not served by this API; this clip is model output only."


def provenance(adapter: str) -> str:
    if adapter == "base":
        return f"Generated by {DEFAULT_BASE} with no adapter (base model). {RIGHTS_LINE}"
    info = ADAPTERS[adapter]
    return (
        f"Generated by {info['base']} with the '{adapter}' LoRA adapter, fine-tuned on {info['corpus']} "
        f"({info['trained']}). {RIGHTS_LINE}"
    )


# ── logging: one JSON object per line ──────────────────────────────────────────
class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:  # noqa: D401
        payload = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)), "level": record.levelname, "msg": record.getMessage()}
        for key in ("request_id", "adapter", "ms", "route", "status", "detail"):
            if hasattr(record, key):
                payload[key] = getattr(record, key)
        return json.dumps(payload)


log = logging.getLogger("musicgen-api")
_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(JsonFormatter())
log.addHandler(_handler)
log.setLevel(logging.INFO)
log.propagate = False


# ── model engines (one per base model, one worker thread each) ────────────────
@dataclass
class Engine:
    base_model: str
    model: object = None
    processor: object = None
    lock: threading.Lock = field(default_factory=threading.Lock)
    loaded_adapters: list[str] = field(default_factory=list)
    state: str = "pending"  # pending | loading | ready | failed
    load_seconds: float | None = None
    error: str | None = None

    def load(self) -> None:
        from peft import PeftModel
        from transformers import AutoProcessor, MusicgenForConditionalGeneration

        self.state = "loading"
        t0 = time.time()
        try:
            self.processor = AutoProcessor.from_pretrained(self.base_model)
            base = MusicgenForConditionalGeneration.from_pretrained(self.base_model, torch_dtype=torch.float32)
            base.config.decoder.decoder_start_token_id = BOS
            model = None
            for name, info in ADAPTERS.items():
                if info["base"] != self.base_model:
                    continue
                if not Path(info["path"]).exists():
                    log.warning("adapter missing", extra={"adapter": name, "detail": str(info["path"])})
                    continue
                if model is None:
                    model = PeftModel.from_pretrained(base, str(info["path"]), adapter_name=name)
                else:
                    model.load_adapter(str(info["path"]), adapter_name=name)
                self.loaded_adapters.append(name)
            if model is None:
                model = base
            model.to(DEVICE).eval()
            self.model = model
            self.load_seconds = round(time.time() - t0, 1)
            self.state = "ready"
            log.info("model loaded", extra={"detail": {"base_model": self.base_model, "device": DEVICE, "adapters": self.loaded_adapters, "seconds": self.load_seconds}})
        except Exception as exc:  # noqa: BLE001 — a failed engine must not take the others down
            self.state = "failed"
            self.error = f"{type(exc).__name__}: {exc}"[:300]
            log.error("model load failed", extra={"detail": {"base_model": self.base_model, "error": self.error}})

    def _use(self, adapter: str):
        """Context manager: adapters disabled for `base`, else set_adapter(name)."""
        from contextlib import nullcontext

        if adapter == "base":
            return self.model.disable_adapter() if self.loaded_adapters else nullcontext()
        self.model.set_adapter(adapter)
        return nullcontext()

    def generate(self, prompt: str, seconds: int, cfg: float, seed: int, adapter: str, out_path: Path) -> dict:
        with self.lock:
            torch.manual_seed(seed)
            inputs = self.processor(text=[prompt], padding=True, return_tensors="pt").to(DEVICE)
            t0 = time.time()
            with torch.no_grad(), self._use(adapter):
                audio = self.model.generate(**inputs, do_sample=True, guidance_scale=cfg, max_new_tokens=int(seconds * 50))
            gen_s = time.time() - t0
            sr = self.model.config.audio_encoder.sampling_rate
            wav = audio[0].cpu().numpy().squeeze().astype(np.float32)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            sf.write(out_path, wav, sr, subtype="PCM_16")
            if DEVICE == "mps":
                torch.mps.empty_cache()
            return {"seconds_generated": round(len(wav) / sr, 2), "sample_rate": sr, "generation_seconds": round(gen_s, 2)}

    def pcs(self, wav_path: Path) -> dict:
        with self.lock:
            audio, sr = sf.read(wav_path, dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            f0, pd = extract_f0(audio, DEVICE, sr=sr)
            res = score_frames(f0, pd)
            if DEVICE == "mps":
                torch.mps.empty_cache()
            if res is None:
                return {"scored": False, "reason": "fewer than 1 s of voiced frames — no usable melody to score"}
            return {
                "scored": True,
                "pcs": round(res.pcs, 4),
                "voiced_fraction": round(res.voiced_fraction, 3),
                "tonic": res.tonic_name,
                "mode": res.mode,
                "tuning_offset_cents": round(res.tuning_offset_cents, 1),
                "n_voiced_frames": res.n_voiced_frames,
            }

    def memory(self) -> dict:
        if DEVICE != "mps":
            return {}
        return {"mps_allocated_mb": round(torch.mps.current_allocated_memory() / 2**20), "mps_driver_mb": round(torch.mps.driver_allocated_memory() / 2**20)}


ENGINES: dict[str, Engine] = {m: Engine(m) for m in ENGINE_MODELS}
ADAPTER_BASE: dict[str, str] = {name: info["base"] for name, info in ADAPTERS.items()} | {"base": DEFAULT_BASE}
queue_waiting = 0
queue_lock = threading.Lock()


def engine_for(adapter: str) -> Engine | None:
    base = ADAPTER_BASE.get(adapter)
    return ENGINES.get(base) if base else None


def is_loaded(adapter: str) -> bool:
    eng = engine_for(adapter)
    if eng is None or eng.state != "ready":
        return False
    return adapter == "base" or adapter in eng.loaded_adapters


# ── generation timing per adapter: seconds of compute per second of audio ─────
TIMINGS_FILE = OUTPUT_DIR / "timings.json"
_timings: dict[str, list[float]] = {}
_timings_lock = threading.Lock()


def load_timings() -> None:
    try:
        _timings.update(json.loads(TIMINGS_FILE.read_text()))
    except Exception:  # noqa: BLE001 — no file yet, or unreadable: start empty
        pass


def record_timing(adapter: str, generation_seconds: float, audio_seconds: float) -> None:
    with _timings_lock:
        lst = _timings.setdefault(adapter, [])
        lst.append(round(generation_seconds / max(audio_seconds, 1e-6), 3))
        del lst[:-10]  # the last ten generations
        try:
            TIMINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
            TIMINGS_FILE.write_text(json.dumps(_timings))
        except OSError:
            pass


def timing_summary(adapter: str) -> dict | None:
    lst = sorted(_timings.get(adapter, []))
    if not lst:
        return None
    median = lst[len(lst) // 2]
    return {"seconds_per_audio_second": round(median, 2), "seconds_for_30s_clip": round(30 * median, 1), "n": len(lst)}


def adapter_details() -> list[dict]:
    out = []
    for name in ["base", *ADAPTERS]:
        eng = engine_for(name)
        base = ADAPTER_BASE[name]
        out.append({
            "id": name,
            "base_model": base,
            "size": SIZE_LABEL.get(base, base),
            "loaded": is_loaded(name),
            "engine_state": eng.state if eng else "absent",
            "timing": timing_summary(name),
        })
    return out


# ── auth ───────────────────────────────────────────────────────────────────────
def require_token(authorization: str | None = Header(default=None)) -> None:
    if not TOKEN:
        raise HTTPException(503, "server has no MUSICGEN_API_TOKEN configured")
    if not authorization or not authorization.startswith("Bearer ") or authorization.removeprefix("Bearer ").strip() != TOKEN:
        raise HTTPException(401, "missing or invalid bearer token")


# ── app ────────────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    load_timings()
    await asyncio.to_thread(ENGINES[DEFAULT_BASE].load)  # the API answers once the default engine is up
    for model_id, eng in ENGINES.items():
        if model_id != DEFAULT_BASE:  # the others load behind the running service
            threading.Thread(target=eng.load, name=f"load-{model_id}", daemon=True).start()
    yield


app = FastAPI(title="QaraamiGen MusicGen API", version="1.0.0", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/static", StaticFiles(directory=HERE / "static"), name="static")


@app.middleware("http")
async def request_id_and_log(request: Request, call_next):
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    request.state.request_id = rid
    t0 = time.time()
    try:
        response = await call_next(request)
    except HTTPException as exc:  # pragma: no cover
        response = JSONResponse({"error": exc.detail}, status_code=exc.status_code)
    response.headers["X-Request-ID"] = rid
    log.info("request", extra={"request_id": rid, "route": f"{request.method} {request.url.path}", "status": response.status_code, "ms": round((time.time() - t0) * 1000)})
    return response


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=400)
    duration: int = Field(default=10, ge=1, le=MAX_SECONDS)
    cfg: float = Field(default=3.0, ge=1.0, le=10.0)
    seed: int = Field(default=42, ge=0, le=2**31 - 1)
    adapter: str = Field(default="oud", max_length=40)
    score: bool = Field(default=False, description="Also run PCS on the generated clip")


@app.get("/health")
async def health():
    default = ENGINES[DEFAULT_BASE]
    return {
        "ok": default.state == "ready",
        "device": DEVICE,
        "base_model": DEFAULT_BASE,
        "adapters_loaded": [name for name in ADAPTERS if is_loaded(name)],
        "engines": {m: {"size": SIZE_LABEL.get(m, m), "state": e.state, "adapters": e.loaded_adapters,
                        "load_seconds": e.load_seconds, "error": e.error} for m, e in ENGINES.items()},
        "adapter_details": adapter_details(),
        "queue": {"waiting": queue_waiting, "max": QUEUE_MAX, "busy": any(e.lock.locked() for e in ENGINES.values())},
        "memory": default.memory(),
        "uptime_seconds": round(time.time() - STARTED),
    }


@app.get("/adapters", dependencies=[Depends(require_token)])
async def adapters():
    return {
        "base_model": DEFAULT_BASE,
        "adapters": {
            name: {k: (str(v) if k == "path" else v) for k, v in info.items()} | {"loaded": is_loaded(name), "provenance": provenance(name), "timing": timing_summary(name)}
            for name, info in ADAPTERS.items()
        },
        "base_provenance": provenance("base"),
    }


@app.post("/generate", dependencies=[Depends(require_token)])
async def generate(req: GenerateRequest, request: Request):
    global queue_waiting
    eng = engine_for(req.adapter)
    if eng is None:
        raise HTTPException(404, f"adapter '{req.adapter}' does not exist; loaded: {[n for n in ADAPTER_BASE if is_loaded(n)]}")
    if not is_loaded(req.adapter):
        raise HTTPException(503, f"adapter '{req.adapter}' is not ready: its engine ({eng.base_model}) is {eng.state}"
                            + (f" ({eng.error})" if eng.error else ""), headers={"Retry-After": "30"})
    with queue_lock:
        if queue_waiting >= QUEUE_MAX:
            raise HTTPException(429, f"queue full ({QUEUE_MAX} waiting); retry shortly", headers={"Retry-After": "15"})
        queue_waiting += 1
    gen_id = uuid.uuid4().hex[:16]
    out = OUTPUT_DIR / f"{gen_id}.wav"
    t0 = time.time()
    try:
        stats = await asyncio.to_thread(eng.generate, req.prompt, req.duration, req.cfg, req.seed, req.adapter, out)
        record_timing(req.adapter, stats["generation_seconds"], stats["seconds_generated"])
        pcs = await asyncio.to_thread(ENGINES[DEFAULT_BASE].pcs, out) if req.score else None
    finally:
        with queue_lock:
            queue_waiting -= 1
    meta = {
        "id": gen_id,
        "adapter": req.adapter,
        "prompt": req.prompt,
        "duration": req.duration,
        "cfg": req.cfg,
        "seed": req.seed,
        "audio_url": f"/audio/{gen_id}",
        "provenance": provenance(req.adapter),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "request_id": request.state.request_id,
        **stats,
        "total_seconds": round(time.time() - t0, 2),
    }
    if pcs is not None:
        meta["pcs"] = pcs
    (OUTPUT_DIR / f"{gen_id}.json").write_text(json.dumps(meta, indent=2))
    log.info("generated", extra={"request_id": request.state.request_id, "adapter": req.adapter, "ms": round(meta["total_seconds"] * 1000), "detail": {"id": gen_id, "duration": req.duration, "seed": req.seed}})
    return meta


@app.get("/audio/{gen_id}", dependencies=[Depends(require_token)])
async def audio(gen_id: str):
    if not gen_id.isalnum():
        raise HTTPException(400, "bad id")
    path = OUTPUT_DIR / f"{gen_id}.wav"
    if not path.exists():
        raise HTTPException(404, "no such generation")
    return FileResponse(path, media_type="audio/wav", filename=f"qaraamigen-{gen_id}.wav", headers={"Cache-Control": "no-store"})


@app.get("/generations/{gen_id}", dependencies=[Depends(require_token)])
async def generation_meta(gen_id: str):
    if not gen_id.isalnum():
        raise HTTPException(400, "bad id")
    path = OUTPUT_DIR / f"{gen_id}.json"
    if not path.exists():
        raise HTTPException(404, "no such generation")
    return json.loads(path.read_text())


@app.post("/pcs", dependencies=[Depends(require_token)])
async def pcs(generation_id: str | None = None, file: UploadFile | None = File(default=None)):
    """Pentatonic Conformity Score for a generated clip (by id) or an uploaded WAV/FLAC."""
    global queue_waiting
    if generation_id:
        if not generation_id.isalnum():
            raise HTTPException(400, "bad id")
        path = OUTPUT_DIR / f"{generation_id}.wav"
        if not path.exists():
            raise HTTPException(404, "no such generation")
        cleanup = False
    elif file is not None:
        data = await file.read()
        if len(data) > 40 * 2**20:
            raise HTTPException(413, "file too large (40 MB max)")
        path = OUTPUT_DIR / f"upload-{uuid.uuid4().hex[:12]}.wav"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        cleanup = True
    else:
        raise HTTPException(400, "provide generation_id or a file")
    with queue_lock:
        if queue_waiting >= QUEUE_MAX:
            raise HTTPException(429, "queue full; retry shortly", headers={"Retry-After": "15"})
        queue_waiting += 1
    try:
        result = await asyncio.to_thread(ENGINES[DEFAULT_BASE].pcs, path)
    except Exception as exc:  # corrupt upload etc.
        raise HTTPException(422, f"could not score file: {type(exc).__name__}") from exc
    finally:
        with queue_lock:
            queue_waiting -= 1
        if cleanup:
            path.unlink(missing_ok=True)
    return {"source": generation_id or file.filename, **result, "note": "PCS = duration-weighted fraction of voiced frames within ±50 cents of the detected pentatonic scale (torchcrepe f0). Reported with voiced fraction; never alone."}


@app.get("/demo", response_class=HTMLResponse)
async def demo():
    return (HERE / "static/index.html").read_text()


@app.get("/")
async def root():
    return {"service": "QaraamiGen MusicGen API", "demo": "/demo", "health": "/health", "auth": "Bearer token on every route except /health and /demo"}
