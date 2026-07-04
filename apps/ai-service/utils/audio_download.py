"""Audio download + preparation for transcription (SESSION P3-01, §8/§10/§11).

Pipeline: presigned R2 URL → temp download → format/duration validation →
16 kHz mono WAV (Whisper's native input) → guaranteed temp cleanup.

WHY validate here and not trust the caller: the AI service is a second trust
boundary. Even though the Node API already restricts formats at upload (§11
Threat 5), a defense-in-depth check costs nothing and protects the GPU workers
from being fed something ffmpeg would choke on for minutes.

WHY the pure validators are separate top-level functions: they are the branchy,
fail-prone logic, so they get direct unit tests with zero I/O. The ffmpeg/httpx
plumbing wraps them and is exercised in integration, not unit, tests.

Module-level imports are stdlib-only (Phase-0 convention) so tests run without
httpx/ffmpeg installed.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

logger = logging.getLogger("ai.audio")

# Formats accepted by the platform (mirrors @sma/validators, §11 Threat 5).
ALLOWED_EXTENSIONS: frozenset[str] = frozenset({".wav", ".webm", ".flac"})

# Duration bounds from the pipeline spec (ARCHITECTURE.md §10 Job 1).
MIN_DURATION_SEC: float = 10.0
MAX_DURATION_SEC: float = 60.0 * 60.0

_SAFE_ID = re.compile(r"[^a-zA-Z0-9\-_]")


class AudioValidationError(ValueError):
    """A permanent input problem (bad format/duration) — never worth retrying."""


# ── Pure validators (unit-tested) ─────────────────────────────────────────────


def extension_from_url(url: str) -> str:
    """Lowercased file extension of a URL's path, ignoring the query string.

    Presigned R2 URLs carry long signatures after `?`; the object key before it
    ends in the real extension because upload keys are minted as `<uuid>.<ext>`.
    """
    path = url.split("?", 1)[0]
    return os.path.splitext(path)[1].lower()


def validate_format(url: str) -> str:
    """Ensure the URL points at an allowed audio format; returns the extension."""
    ext = extension_from_url(url)
    if ext not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise AudioValidationError(
            f"Unsupported audio format '{ext or 'none'}' — expected one of: {allowed}"
        )
    return ext


def validate_duration(seconds: float) -> None:
    """Enforce the 10 s – 60 min window (§10): shorter clips are fragments/noise,
    longer ones must be split per song before entering the pipeline."""
    if seconds < MIN_DURATION_SEC:
        raise AudioValidationError(
            f"Recording too short ({seconds:.1f}s) — minimum is {MIN_DURATION_SEC:.0f}s"
        )
    if seconds > MAX_DURATION_SEC:
        raise AudioValidationError(
            f"Recording too long ({seconds:.1f}s) — maximum is {MAX_DURATION_SEC:.0f}s"
        )


# ── I/O plumbing (ffmpeg + httpx, integration-tested) ─────────────────────────


def _download(url: str, dest: Path) -> None:
    """Stream the remote audio to `dest` (no giant in-memory buffer)."""
    import httpx

    with httpx.Client(timeout=120.0) as client, client.stream("GET", url) as response:
        response.raise_for_status()
        with dest.open("wb") as fh:
            for chunk in response.iter_bytes():
                fh.write(chunk)


def probe_duration(path: Path) -> float:
    """Read the clip duration via ffprobe (authoritative, container-agnostic)."""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=True,
        )
        return float(result.stdout.strip())
    except (subprocess.SubprocessError, ValueError, OSError) as exc:
        raise AudioValidationError(f"Could not determine audio duration: {exc}") from exc


def convert_to_wav_16k_mono(src: Path, dest: Path) -> None:
    """Transcode to 16 kHz mono WAV — Whisper's expected input.

    Whisper can decode other formats itself, but normalising here means one
    decode instead of two (transcribe + translate passes reuse the same WAV)
    and removes container quirks from the model's path.
    """
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", str(src), "-ar", "16000", "-ac", "1", str(dest)],
            capture_output=True,
            timeout=300,
            check=True,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        raise AudioValidationError(f"Audio conversion failed: {exc}") from exc


@contextmanager
def prepared_audio(url: str, recording_id: str) -> Iterator[Path]:
    """Download → validate → convert; yields the 16 kHz WAV path; always cleans up.

    A context manager so that no matter how transcription exits (success, model
    error, worker timeout raising SoftTimeLimitExceeded), the multi-hundred-MB
    temp files never accumulate on the worker disk.
    """
    validate_format(url)
    safe_id = _SAFE_ID.sub("_", recording_id) or "recording"
    tmpdir = Path(tempfile.mkdtemp(prefix=f"sma-{safe_id}-"))
    try:
        raw = tmpdir / f"raw{extension_from_url(url)}"
        logger.info("downloading audio recording_id=%s", recording_id)
        _download(url, raw)

        duration = probe_duration(raw)
        validate_duration(duration)

        wav = tmpdir / "audio-16k.wav"
        convert_to_wav_16k_mono(raw, wav)
        logger.info(
            "audio prepared recording_id=%s duration=%.1fs", recording_id, duration
        )
        yield wav
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
