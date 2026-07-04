"""Unit tests for embedding validation/normalisation (SESSION P3-03).

MERT is never invoked — synthetic vectors exercise the gate between model
output and pgvector storage. Dependency-light like the rest of the suite.
"""

from __future__ import annotations

import math

import pytest

from services.embedding_service import (
    EMBEDDING_ROUND_DECIMALS,
    MERT_EMBEDDING_DIM,
    EmbeddingValidationError,
    finalize_embedding,
    l2_normalize,
    validate_embedding,
)


def vec(fill: float = 0.5, dim: int = MERT_EMBEDDING_DIM) -> list[float]:
    return [fill] * dim


# ── validate_embedding: the corruption gate ───────────────────────────────────


def test_valid_vector_passes() -> None:
    validate_embedding(vec())  # no raise


def test_wrong_dimension_rejected() -> None:
    with pytest.raises(EmbeddingValidationError, match="767"):
        validate_embedding(vec(dim=767))


def test_nan_and_inf_rejected() -> None:
    bad_nan = vec()
    bad_nan[100] = float("nan")
    with pytest.raises(EmbeddingValidationError, match="NaN"):
        validate_embedding(bad_nan)

    bad_inf = vec()
    bad_inf[5] = float("inf")
    with pytest.raises(EmbeddingValidationError, match="NaN/inf"):
        validate_embedding(bad_inf)


def test_zero_vector_rejected() -> None:
    with pytest.raises(EmbeddingValidationError, match="zero"):
        validate_embedding(vec(0.0))


# ── l2_normalize ──────────────────────────────────────────────────────────────


def test_normalized_vector_has_unit_norm() -> None:
    unit = l2_normalize([3.0, 4.0])
    assert unit == pytest.approx([0.6, 0.8])
    assert math.sqrt(sum(v * v for v in unit)) == pytest.approx(1.0)


def test_direction_is_preserved() -> None:
    a = l2_normalize([1.0, 2.0, 2.0])
    b = l2_normalize([10.0, 20.0, 20.0])  # same direction, 10× magnitude
    assert a == pytest.approx(b)


def test_zero_vector_cannot_be_normalized() -> None:
    with pytest.raises(EmbeddingValidationError):
        l2_normalize([0.0, 0.0])


# ── finalize_embedding: the single model→storage gate ─────────────────────────


def test_finalize_validates_normalizes_and_rounds() -> None:
    result = finalize_embedding(vec(2.0), "mert-v1-95m")

    assert result.dim == MERT_EMBEDDING_DIM
    assert result.model_version == "mert-v1-95m"
    norm = math.sqrt(sum(v * v for v in result.embedding))
    assert norm == pytest.approx(1.0, abs=1e-3)
    # Every component rounded to the payload precision.
    assert all(round(v, EMBEDDING_ROUND_DECIMALS) == v for v in result.embedding)


def test_finalize_rejects_corrupt_output_before_storage() -> None:
    with pytest.raises(EmbeddingValidationError):
        finalize_embedding(vec(dim=10), "mert-v1-95m")


def test_payload_matches_storage_contract() -> None:
    payload = finalize_embedding(vec(1.0), "mert-v1-95m").to_payload()
    assert set(payload) == {"embedding", "model_version", "dim"}
    assert payload["dim"] == MERT_EMBEDDING_DIM
    assert len(payload["embedding"]) == MERT_EMBEDDING_DIM
