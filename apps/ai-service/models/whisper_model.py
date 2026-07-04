"""Whisper large-v3 loading (SESSION P3-01, ARCHITECTURE.md §10).

WHY lazy + cached: large-v3 is ~3 GB of weights and takes tens of seconds to load.
Loading at import time would make every service boot (and every test run) pay that
cost; loading per-request would be catastrophic. So the model loads exactly once,
on the first transcription request, and is cached for the process lifetime.

WHY device fallback: development happens on an Apple M4 Pro where Metal (MPS) is
the fast path, but some Whisper ops have historically been unsupported on MPS and
GPU memory can be exhausted by large-v3. Rather than crashing the worker, loading
falls back to CPU with a clear log line — slower, but the archive keeps processing.

All heavy imports (torch, whisper) live INSIDE functions so importing this module
costs nothing and the unit tests never need the ML stack (Phase-0 convention).
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

from config import get_settings

logger = logging.getLogger("ai.whisper")


class WhisperLoadError(RuntimeError):
    """Raised when the Whisper model cannot be loaded on any device.

    Carries an actionable message (download the weights, free memory) instead of
    surfacing a raw torch stack trace to the caller.
    """


def pick_device() -> str:
    """Choose the best available inference device.

    Preference order: Apple MPS (M-series GPU — the M4 Pro dev machine), then
    CUDA, then CPU. Explicit override via WHISPER_DEVICE wins in config.
    """
    import torch

    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _load_on(name: str, device: str) -> Any:
    """Load the named Whisper model onto a specific device (raises on failure)."""
    import whisper

    return whisper.load_model(name, device=device)


@lru_cache
def get_whisper_model() -> Any:
    """Load Whisper once, preferring the configured/auto-detected device.

    Failure handling:
      * missing/corrupt weights → WhisperLoadError telling the operator what to do,
      * out-of-memory or unsupported ops on MPS/CUDA → one retry on CPU, because a
        slow transcription beats a dead pipeline for an archive that must not stall.
    """
    settings = get_settings()
    device = settings.whisper_device or pick_device()
    name = settings.whisper_model

    logger.info("loading whisper model=%s device=%s", name, device)
    try:
        model = _load_on(name, device)
        logger.info("whisper loaded model=%s device=%s", name, device)
        return model
    except FileNotFoundError as exc:  # weights missing from the cache dir
        raise WhisperLoadError(
            f"Whisper weights for '{name}' not found. First run downloads them; "
            "check network access and the ~/.cache/whisper directory."
        ) from exc
    except (RuntimeError, MemoryError) as exc:
        # Covers CUDA/MPS out-of-memory and MPS unsupported-op errors.
        if device == "cpu":
            raise WhisperLoadError(
                f"Whisper '{name}' failed to load on CPU: {exc}. "
                "Consider WHISPER_MODEL=medium if memory is constrained."
            ) from exc
        logger.warning("whisper load failed on %s (%s); retrying on cpu", device, exc)
        try:
            model = _load_on(name, "cpu")
            logger.info("whisper loaded model=%s device=cpu (fallback)", name)
            return model
        except (RuntimeError, MemoryError, FileNotFoundError) as cpu_exc:
            raise WhisperLoadError(
                f"Whisper '{name}' failed on {device} and on CPU fallback: {cpu_exc}"
            ) from cpu_exc


def fp16_for(model: Any) -> bool:
    """Whether to run inference in fp16 — only worthwhile on CUDA.

    CPU fp16 triggers a warning + silent fp32 fallback inside Whisper, and MPS
    fp16 support has been flaky; fp32 there is the reliable choice.
    """
    return "cuda" in str(getattr(model, "device", "cpu"))
