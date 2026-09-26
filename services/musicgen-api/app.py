"""QaraamiGen inference service — MusicGen base models + fine-tuned adapters, served locally.
One engine per base model (small and large by default); each adapter belongs to one
base. The default engine loads before the API accepts requests, the others load in
the background and their adapters answer 503 until ready.

One process, batch size 1 always. Adapters are loaded once and hot-swapped per
request with PEFT's set_adapter; `base` runs with adapters disabled. A single
worker thread per engine serialises generation and PCS scoring (MPS is not safely
re-entrant); at most QUEUE_MAX requests may wait.

Adapter registry: the built-in ADAPTERS dict below plus adapters.extra.json next
to this file (a JSON list, written by apps/ai-service/scripts/register_adapter.py),
merged at import so a new run is served without editing Python:
  {name, kind: "lora" | "full_decoder", path (repo-relative or absolute), base,
   corpus, trained, metrics, listening_gate, rights: "releasable" | "research_only",
   best_step}
A LoRA entry is loaded onto its base model's engine (an engine is added for a base
that MUSICGEN_ENGINES does not list). A full_decoder entry — a full fine-tune of the
decoder saved as decoder.safetensors — gets its own engine keyed "<base>::<name>"
that loads the base model and then the decoder state dict. Entries with an unknown
kind or without a base are logged and skipped; an entry whose path does not exist
stays in the registry, is reported as not loaded with an `error` in /health's
adapter_details ("adapter missing" warning at load time) and /generate answers 404
for it: nothing will change until the checkpoint appears and the service restarts.

Rights: every generation response carries a `provenance` statement naming the
adapter's training corpus and stating that source audio is not distributed. The
service never serves corpus audio — only its own generated clips. Adapters whose
training data includes research-only recordings (the Harvard collection) carry
rights "research_only" and are flagged research_only in /health, /adapters and on
the demo page; they are served on this private (loopback + Tailscale) service only.

Auth: Bearer token read from an env file OUTSIDE the repo (MUSICGEN_API_ENV_FILE,
default ~/ai/musicgen-api/musicgen-api.env). /health is unauthenticated (no data).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager, nullcontext, suppress
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


# ── adapter registry ───────────────────────────────────────────────────────────
KINDS = ("lora", "full_decoder")
RIGHTS_VALUES = ("releasable", "research_only")
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$")  # matches GenerateRequest.adapter max_length
DECODER_WEIGHTS = "decoder.safetensors"
EXTRA_FILE = Path(os.environ.get("MUSICGEN_ADAPTERS_EXTRA", HERE / "adapters.extra.json"))

# Built-in adapters (the pre-registry runs). Registered entries with the same name win.
BUILTIN_ADAPTERS: dict[str, dict] = {
    "oud": {
        "path": REPO / "runs/oud_lora_r16_nodrop_20260809/ckpt_step_0500",
        "corpus": "the privately shared oud (kaban) qaraami collection — 28 songs, 1,921 fifteen-second clips",
        "trained": "2026-08-09, LoRA r=16 α=32 on decoder q/k/v/out, lr 1e-4 cosine, 1,000 steps, best checkpoint step 500",
        "metrics": {"val_ce": {"base": 4.5132, "adapter": 4.4785}, "test_ce": {"base": 2.6302, "adapter": 2.6092}},
        "listening_gate": "passed (Khalid, 2026-09)",
        "base": "facebook/musicgen-small",
        "rights": "releasable",
    },
    "harvard_raw": {
        "path": REPO / "runs/harvard_raw_3000/ckpt_step_2750",
        "corpus": "the Maryan 'Aryette' Omar Ali Collection (Harvard Loeb Music Library, AWM Spec Coll 103) — 119 tracks, 11,386 fifteen-second clips, raw audio",
        "trained": "2026-09-03, LoRA r=16 α=32 on decoder q/k/v/out, lr 1e-4 cosine, 3,000 steps, best checkpoint step 2750",
        "metrics": {"val_ce": {"base": 4.6262, "adapter": 4.5501}, "test_ce": {"base": 4.8363, "adapter": 4.7468}},
        "listening_gate": "not yet performed",
        "base": "facebook/musicgen-small",
        "rights": "research_only",
    },
    "large": {
        "path": REPO / "runs/qaraami_large_r32/ckpt_step_2750",
        "corpus": "the held qaraami corpus: the oud collection, the band recordings and the Harvard cassette collection — 43 h, 9,662 thirty-second clips",
        "trained": "2026-09-05, LoRA r=32 α=64 on decoder attention and feed-forward projections, lr 5e-5, 3,000 steps, best checkpoint step 2750",
        "metrics": {"val_ce": {"base": 4.4305, "adapter": 4.3244}, "test_ce": {"base": 4.0750, "adapter": 3.9469}},
        "listening_gate": "not yet performed",
        "base": "facebook/musicgen-large",
        "rights": "research_only",
    },
}
RIGHTS_LINE = "Source recordings are not distributed and are not served by this API; this clip is model output only."
RESEARCH_ONLY_LINE = ("Research-only adapter: its training data includes recordings held under research-only terms; "
                      "it is served on this private network only and is not published.")


def resolve_repo_path(path: str | Path) -> Path:
    """A registry path is repo-relative unless absolute."""
    p = Path(path).expanduser()
    return p if p.is_absolute() else REPO / p


def step_of(path: str | Path) -> int | None:
    """The NNNN of a ckpt_step_NNNN checkpoint directory, else None."""
    m = re.search(r"ckpt_step_(\d+)", Path(path).name)
    return int(m.group(1)) if m else None


def normalise_entry(entry: dict, source: str) -> tuple[str, dict] | None:
    """Validate one registry entry and shape it like a BUILTIN_ADAPTERS value.
    Returns None (after a log line) for an entry the service must not try to
    serve: no usable name, unknown kind, missing base or missing path KEY. A path
    that does not exist on disk is kept — the engine reports "adapter missing".
    Missing or unknown rights default to research_only (never the other way)."""
    if not isinstance(entry, dict):
        log.warning("adapter entry skipped", extra={"detail": {"source": source, "reason": "entry is not an object"}})
        return None
    name = entry.get("name")
    if not isinstance(name, str) or not NAME_RE.fullmatch(name) or name == "base":
        log.warning("adapter entry skipped", extra={"detail": {"source": source, "reason": f"bad name {name!r}"}})
        return None
    kind = entry.get("kind", "lora")
    if kind not in KINDS:
        log.warning("adapter entry skipped", extra={"adapter": name, "detail": {"source": source, "reason": f"unknown kind {kind!r}; known: {list(KINDS)}"}})
        return None
    base = entry.get("base")
    if not isinstance(base, str) or not base.strip():
        log.warning("adapter entry skipped", extra={"adapter": name, "detail": {"source": source, "reason": "missing base model"}})
        return None
    path = entry.get("path")
    if not isinstance(path, str | Path) or not str(path).strip():
        log.warning("adapter entry skipped", extra={"adapter": name, "detail": {"source": source, "reason": "missing path"}})
        return None
    rights = entry.get("rights")
    if rights not in RIGHTS_VALUES:
        log.warning("adapter rights defaulted to research_only", extra={"adapter": name, "detail": {"source": source, "rights": rights}})
        rights = "research_only"
    metrics = entry.get("metrics")
    best_step = entry.get("best_step")
    info = {k: v for k, v in entry.items() if k != "name"}
    info.update({
        "path": resolve_repo_path(path),
        "kind": kind,
        "base": base.strip(),
        "rights": rights,
        "corpus": str(entry.get("corpus") or "an unnamed corpus"),
        "trained": str(entry.get("trained") or "training details not recorded"),
        "metrics": metrics if isinstance(metrics, dict) else {},
        "listening_gate": str(entry.get("listening_gate") or "not yet performed"),
        "best_step": best_step if isinstance(best_step, int) and not isinstance(best_step, bool) else step_of(path),
    })
    return name, info


def load_extra_adapters(extra_file: Path, builtin: dict[str, dict]) -> dict[str, dict]:
    """The merged registry: built-in entries (normalised) then adapters.extra.json.
    A missing file is normal (logged at info); an unreadable one or one that is not
    a JSON list is logged as an error and ignored, so the service still starts
    with the built-ins. Within the file a later duplicate name wins; a registered
    name equal to a built-in replaces the built-in."""
    merged: dict[str, dict] = {}
    for name, info in builtin.items():
        norm = normalise_entry({"name": name, **info}, "builtin")
        if norm is not None:
            merged[norm[0]] = norm[1]
    if not extra_file.exists():
        log.info("adapter registry absent", extra={"detail": str(extra_file)})
        return merged
    try:
        entries = json.loads(extra_file.read_text())
    except (OSError, ValueError) as exc:
        log.error("adapter registry unreadable", extra={"detail": {"file": str(extra_file), "error": f"{type(exc).__name__}: {exc}"[:200]}})
        return merged
    if not isinstance(entries, list):
        log.error("adapter registry ignored", extra={"detail": {"file": str(extra_file), "reason": "top level is not a JSON list"}})
        return merged
    for i, entry in enumerate(entries):
        norm = normalise_entry(entry, f"{extra_file.name}[{i}]")
        if norm is None:
            continue
        name, info = norm
        if name in merged:
            log.info("adapter registry overrides earlier entry", extra={"adapter": name, "detail": "builtin" if name in builtin and name not in [e.get("name") for e in entries[:i] if isinstance(e, dict)] else "duplicate"})
        merged[name] = info
    log.info("adapter registry loaded", extra={"detail": {"file": str(extra_file), "entries": len(entries), "adapters": sorted(merged)}})
    return merged


ADAPTERS: dict[str, dict] = load_extra_adapters(EXTRA_FILE, BUILTIN_ADAPTERS)


def engine_key(name: str, info: dict) -> str:
    """The engine an adapter is served by: its base model for LoRA (shared with
    every LoRA adapter of that base), "<base>::<name>" for a full decoder."""
    return f"{info['base']}::{name}" if info["kind"] == "full_decoder" else info["base"]


def is_research_only(name: str) -> bool:
    return name != "base" and ADAPTERS[name]["rights"] == "research_only"


def provenance(adapter: str) -> str:
    if adapter == "base":
        return f"Generated by {DEFAULT_BASE} with no adapter (base model). {RIGHTS_LINE}"
    info = ADAPTERS[adapter]
    how = "full-decoder fine-tune" if info["kind"] == "full_decoder" else "LoRA adapter"
    text = (f"Generated by {info['base']} with the '{adapter}' {how}, fine-tuned on {info['corpus']} "
            f"({info['trained']}). {RIGHTS_LINE}")
    if info["rights"] == "research_only":
        text += " " + RESEARCH_ONLY_LINE
    return text


def _patch_melody_prefix(model) -> bool:
    """transformers 4.57: musicgen-melody's prepare_inputs_for_generation drops the text+chroma
    prefix when generate() hands it an empty cache at step 1, making every clip unconditional.
    The research harness carries the fix (scripts.scale_eval.patch_melody_generation); apply it
    here when the AI-service package is importable, else log and serve unpatched."""
    try:
        import sys as _sys

        ai_service = str(REPO / "apps" / "ai-service")
        if ai_service not in _sys.path:
            _sys.path.insert(0, ai_service)
        from scripts.scale_eval import patch_melody_generation  # noqa: PLC0415

        return bool(patch_melody_generation(model))
    except Exception as exc:  # noqa: BLE001
        log.warning("melody prefix patch not applied", extra={"detail": f"{type(exc).__name__}: {exc}"[:200]})
        return False


# ── model engines (one per base model or full-decoder fine-tune, one worker thread each) ──
def model_class(base_model: str):
    from transformers import (
        MusicgenForConditionalGeneration,
        MusicgenMelodyForConditionalGeneration,
    )

    return MusicgenMelodyForConditionalGeneration if "melody" in base_model else MusicgenForConditionalGeneration


def decoder_weights_file(path: Path) -> Path:
    """A full_decoder entry's path is the checkpoint directory holding
    decoder.safetensors, or that file itself."""
    return path if path.suffix == ".safetensors" else path / DECODER_WEIGHTS


def load_decoder_state(model, weights: Path) -> int:
    """Load a full-decoder fine-tune (safetensors state dict of model.decoder, the
    MusicgenForCausalLM: model.decoder.* and lm_heads.*) into the base model in
    place. Keys saved from the whole model carry a leading "decoder." that is
    stripped. Any missing or unexpected key is an error: half a decoder is not
    the adapter. Returns the number of tensors loaded."""
    from safetensors.torch import load_file

    sd = load_file(str(weights))
    if sd and all(k.startswith("decoder.") for k in sd):
        sd = {k[len("decoder."):]: v for k, v in sd.items()}
    result = model.decoder.load_state_dict(sd, strict=False)
    missing, unexpected = list(result.missing_keys), list(result.unexpected_keys)
    if missing or unexpected:
        raise ValueError(f"{weights.name} does not match the decoder: {len(missing)} missing (e.g. {missing[:2]}), "
                         f"{len(unexpected)} unexpected (e.g. {unexpected[:2]})")
    return len(sd)


@dataclass
class Engine:
    base_model: str
    kind: str = "lora"  # lora: base + every LoRA adapter of this base | full_decoder: base with one decoder state dict
    adapter_name: str | None = None  # full_decoder only
    model: object = None
    processor: object = None
    lock: threading.Lock = field(default_factory=threading.Lock)
    loaded_adapters: list[str] = field(default_factory=list)
    missing_adapters: dict[str, str] = field(default_factory=dict)  # adapter -> path skipped at load (weights not on disk)
    state: str = "pending"  # pending | loading | ready | failed
    load_seconds: float | None = None
    error: str | None = None

    @property
    def key(self) -> str:
        return f"{self.base_model}::{self.adapter_name}" if self.kind == "full_decoder" else self.base_model

    def load(self) -> None:
        from transformers import AutoProcessor

        self.state = "loading"
        t0 = time.time()
        try:
            weights = None
            if self.kind == "full_decoder":
                weights = decoder_weights_file(Path(ADAPTERS[self.adapter_name]["path"]))
                if not weights.exists():  # checked before the base model is loaded: nothing to serve here
                    log.warning("adapter missing", extra={"adapter": self.adapter_name, "detail": str(weights)})
                    self.missing_adapters[self.adapter_name] = str(weights)
                    self.state, self.error = "failed", f"adapter missing: {weights}"
                    return
            self.processor = AutoProcessor.from_pretrained(self.base_model)
            base = model_class(self.base_model).from_pretrained(self.base_model, torch_dtype=torch.float32)
            base.config.decoder.decoder_start_token_id = BOS
            model = self._load_full_decoder(base, weights) if self.kind == "full_decoder" else self._load_lora(base)
            if "melody" in self.base_model:
                _patch_melody_prefix(model)
            model.to(DEVICE).eval()
            self.model = model
            self.load_seconds = round(time.time() - t0, 1)
            self.state = "ready"
            log.info("model loaded", extra={"detail": {"engine": self.key, "base_model": self.base_model, "kind": self.kind, "device": DEVICE,
                                                       "adapters": self.loaded_adapters, "seconds": self.load_seconds}})
        except Exception as exc:  # noqa: BLE001 — a failed engine must not take the others down
            self.state = "failed"
            self.error = f"{type(exc).__name__}: {exc}"[:300]
            log.error("model load failed", extra={"detail": {"engine": self.key, "base_model": self.base_model, "error": self.error}})

    def _load_lora(self, base):
        """PeftModel with every present LoRA adapter of this base attached by name."""
        from peft import PeftModel

        model = None
        for name, info in ADAPTERS.items():
            if info["base"] != self.base_model or info["kind"] != "lora":
                continue
            if not Path(info["path"]).exists():
                log.warning("adapter missing", extra={"adapter": name, "detail": str(info["path"])})
                self.missing_adapters[name] = str(info["path"])
                continue
            if model is None:
                model = PeftModel.from_pretrained(base, str(info["path"]), adapter_name=name)
            else:
                model.load_adapter(str(info["path"]), adapter_name=name)
            self.loaded_adapters.append(name)
        return base if model is None else model

    def _load_full_decoder(self, base, weights: Path):
        n = load_decoder_state(base, weights)
        log.info("decoder weights loaded", extra={"adapter": self.adapter_name, "detail": {"file": str(weights), "tensors": n}})
        self.loaded_adapters = [self.adapter_name]
        return base

    def _use(self, adapter: str):
        """Context manager: adapters disabled for `base`, else set_adapter(name); a
        full-decoder engine has nothing to switch."""
        if self.kind == "full_decoder":
            return nullcontext()
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


def build_engines(adapters: dict[str, dict], engine_models: list[str]) -> tuple[dict[str, Engine], dict[str, str]]:
    """Engines keyed by engine_key plus the adapter -> engine key map ("base" is the
    default engine). Every base in engine_models gets a LoRA engine; a LoRA adapter
    on a base not listed there adds one (logged); each full_decoder adapter gets its
    own engine."""
    engines: dict[str, Engine] = {m: Engine(m) for m in engine_models}
    adapter_engine: dict[str, str] = {"base": engine_models[0]}
    for name, info in adapters.items():
        key = engine_key(name, info)
        if key not in engines:
            if info["kind"] == "full_decoder":
                engines[key] = Engine(info["base"], kind="full_decoder", adapter_name=name)
            else:
                engines[key] = Engine(info["base"])
                log.info("engine added for registered adapter", extra={"adapter": name, "detail": {"base_model": info["base"]}})
        adapter_engine[name] = key
    return engines, adapter_engine


ENGINES, ADAPTER_ENGINE = build_engines(ADAPTERS, ENGINE_MODELS)
ADAPTER_BASE: dict[str, str] = {name: info["base"] for name, info in ADAPTERS.items()} | {"base": DEFAULT_BASE}
queue_waiting = 0
queue_lock = threading.Lock()


def engine_for(adapter: str) -> Engine | None:
    key = ADAPTER_ENGINE.get(adapter)
    return ENGINES.get(key) if key else None


def is_loaded(adapter: str) -> bool:
    eng = engine_for(adapter)
    if eng is None or eng.state != "ready":
        return False
    return adapter == "base" or adapter in eng.loaded_adapters


def adapter_error(adapter: str) -> str | None:
    """Why a registered adapter cannot answer, or None: its weights were missing
    when its engine loaded (permanent until the checkpoint appears and the service
    restarts), or its engine failed."""
    eng = engine_for(adapter)
    if eng is None:
        return None
    if adapter in eng.missing_adapters:
        return f"adapter weights missing: {eng.missing_adapters[adapter]}"
    if eng.state == "failed":
        return eng.error
    if eng.state == "ready" and adapter != "base" and adapter not in eng.loaded_adapters:
        return f"adapter not loaded on its engine ({eng.key})"
    return None


# ── generation timing per adapter: seconds of compute per second of audio ─────
TIMINGS_FILE = OUTPUT_DIR / "timings.json"
_timings: dict[str, list[float]] = {}
_timings_lock = threading.Lock()


def load_timings() -> None:
    with suppress(Exception):  # no file yet, or unreadable: start empty
        _timings.update(json.loads(TIMINGS_FILE.read_text()))


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
    """One row per selectable adapter (base first) for /health and the demo page:
    kind, rights and the research_only flag, listening gate, engine and load state."""
    out = []
    for name in ["base", *ADAPTERS]:
        eng = engine_for(name)
        base = ADAPTER_BASE[name]
        info = ADAPTERS.get(name)
        out.append({
            "id": name,
            "base_model": base,
            "size": SIZE_LABEL.get(base, base),
            "kind": info["kind"] if info else "base",
            "rights": info["rights"] if info else "releasable",
            "research_only": is_research_only(name),
            "listening_gate": info["listening_gate"] if info else None,
            "best_step": info["best_step"] if info else None,
            "engine": ADAPTER_ENGINE[name],
            "loaded": is_loaded(name),
            "engine_state": eng.state if eng else "absent",
            "error": adapter_error(name),
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
    for key, eng in ENGINES.items():
        if key != DEFAULT_BASE:  # the others load behind the running service
            threading.Thread(target=eng.load, name=f"load-{key}", daemon=True).start()
    yield


app = FastAPI(title="QaraamiGen MusicGen API", version="1.1.0", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
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
        "adapters_research_only": [name for name in ADAPTERS if is_research_only(name)],
        "registry": str(EXTRA_FILE),
        "engines": {key: {"base_model": e.base_model, "kind": e.kind, "size": SIZE_LABEL.get(e.base_model, e.base_model), "state": e.state,
                          "adapters": e.loaded_adapters, "load_seconds": e.load_seconds, "error": e.error} for key, e in ENGINES.items()},
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
            name: {k: (str(v) if k == "path" else v) for k, v in info.items()}
            | {"research_only": is_research_only(name), "engine": ADAPTER_ENGINE[name], "loaded": is_loaded(name),
               "provenance": provenance(name), "timing": timing_summary(name)}
            for name, info in ADAPTERS.items()
        },
        "base_provenance": provenance("base"),
    }


@app.post("/generate", dependencies=[Depends(require_token)])
async def generate(req: GenerateRequest, request: Request):
    global queue_waiting
    eng = engine_for(req.adapter)
    if eng is None:
        raise HTTPException(404, f"adapter '{req.adapter}' does not exist; loaded: {[n for n in ADAPTER_ENGINE if is_loaded(n)]}")
    if not is_loaded(req.adapter):
        # pending/loading: come back later; failed, or ready without this adapter's
        # weights: nothing clears that until a restart, so no Retry-After.
        if eng.state in ("pending", "loading"):
            raise HTTPException(503, f"adapter '{req.adapter}' is not ready: its engine ({eng.key}) is {eng.state}", headers={"Retry-After": "30"})
        if eng.state == "failed":
            raise HTTPException(503, f"adapter '{req.adapter}' is unavailable: its engine ({eng.key}) failed to load ({eng.error})")
        raise HTTPException(404, f"adapter '{req.adapter}' is registered but not loaded: {adapter_error(req.adapter)}")
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
        "research_only": is_research_only(req.adapter),
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
