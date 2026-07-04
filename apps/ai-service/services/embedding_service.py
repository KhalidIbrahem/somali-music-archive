"""MERT audio embeddings for similarity search (SESSION P3-03, §10 Job 4).

MERT-v1-95M turns a recording into a 768-dimensional vector (mean-pooled over
time, then over layers — capturing multi-level musical features, §10). Those
vectors land in pgvector (§9 audio_embeddings) and power "similar recordings"
and the research embedding export.

WHY validate before storing: a NaN/zeroed/short vector — a silent model
failure — would poison EVERY similarity query it appears in, not just its own
recording. Corrupt vectors are rejected permanently (no retry: NaNs are
deterministic) rather than stored.

WHY L2-normalise: the pgvector index uses cosine ops, which are scale-invariant
— so normalising changes no result, but storing unit vectors makes cosine
equal to dot product, keeps magnitudes comparable across loud/quiet recordings,
and protects any future consumer that assumes inner-product space.

Pure math above the runner (stdlib only, unit-tested); torch/MERT/network enter
only inside ``run_embedding_job`` via lazy imports (Phase-0 convention).
"""

from __future__ import annotations

import logging
import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger("ai.embed")

# MERT-v1-95M hidden size — must match the pgvector column: vector(768) (§9).
MERT_EMBEDDING_DIM: int = 768

# 6 decimals keeps the JSON payload compact (~10 KB) while preserving far more
# precision than cosine ranking can ever use.
EMBEDDING_ROUND_DECIMALS: int = 6


class EmbeddingValidationError(ValueError):
    """A permanently unusable model output (wrong dim, NaN, zero) — never retried."""


@dataclass
class EmbeddingResult:
    """Structured embedding stored via the internal callback (§9 audio_embeddings)."""

    embedding: list[float]
    model_version: str
    dim: int

    def to_payload(self) -> dict[str, Any]:
        """Wire shape POSTed back to the Node API's internal callback."""
        return {"embedding": self.embedding, "model_version": self.model_version, "dim": self.dim}


# ── Pure math (unit-tested) ───────────────────────────────────────────────────


def validate_embedding(vector: Sequence[float], expected_dim: int = MERT_EMBEDDING_DIM) -> None:
    """Reject vectors that would corrupt the similarity index.

    Checks, in order of diagnostic usefulness: dimension (a truncated forward
    pass), non-finite values (fp16 overflow / silent model failure), and zero
    norm (an all-silence or dead output — cosine against it is undefined).
    """
    if len(vector) != expected_dim:
        raise EmbeddingValidationError(
            f"Embedding has {len(vector)} dimensions — expected {expected_dim}"
        )
    if any(not math.isfinite(value) for value in vector):
        raise EmbeddingValidationError("Embedding contains NaN/inf values")
    if all(value == 0.0 for value in vector):
        raise EmbeddingValidationError("Embedding is the zero vector")


def l2_normalize(vector: Sequence[float]) -> list[float]:
    """Scale a vector to unit length (see module docstring for why we store these)."""
    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0.0:
        raise EmbeddingValidationError("Cannot normalise the zero vector")
    return [value / norm for value in vector]


def finalize_embedding(raw: Sequence[float], model_version: str) -> EmbeddingResult:
    """Validate → normalise → round: the single gate between model and storage."""
    values = [float(value) for value in raw]
    validate_embedding(values)
    unit = [round(value, EMBEDDING_ROUND_DECIMALS) for value in l2_normalize(values)]
    return EmbeddingResult(embedding=unit, model_version=model_version, dim=len(unit))


# ── Pipeline runner (worker / background-task entrypoint) ─────────────────────

# MERT-v1-95M was trained on 24 kHz audio — its native input rate, NOT the
# 16 kHz Whisper/CREPE use (see utils/audio_download.convert_to_wav_mono).
MERT_SAMPLE_RATE: int = 24_000


def run_embedding_job(job_id: str, recording_id: str, audio_url: str) -> None:
    """Full job: download at 24 kHz → MERT → validate/normalise → post result.

    Synchronous on purpose (same reasoning as the other stages): inference is
    blocking compute; Celery task or Starlette thread pool, the event loop
    stays free. Raises on transient failure so the retry policy takes over.
    """
    from config import get_settings
    from models.registry import generate_embedding
    from services.callback import post_ai_result
    from utils.audio_download import prepared_audio

    log = logging.LoggerAdapter(logger, {"job_id": job_id, "recording_id": recording_id})
    log.info("embedding job started job_id=%s recording_id=%s", job_id, recording_id)

    with prepared_audio(audio_url, recording_id, sample_rate=MERT_SAMPLE_RATE) as wav_path:
        raw = generate_embedding(str(wav_path))

    settings = get_settings()
    # "m-a-p/MERT-v1-95M" → "mert-v1-95m", the model_version format from §9.
    model_version = settings.mert_model.split("/")[-1].lower()
    result = finalize_embedding(raw, model_version)

    log.info("embedding done job_id=%s dim=%d model=%s", job_id, result.dim, model_version)
    post_ai_result(job_id, recording_id, "embedding", result.to_payload())
