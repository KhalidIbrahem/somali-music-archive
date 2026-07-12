"""Unit tests for the Somali classifier architectures (Phase E2/E3).

Forward-pass contracts only — no training, no audio decode — so CI proves the
models are wired correctly (shapes, label vocabularies, size budget) in
milliseconds.
"""

from __future__ import annotations

import pytest

torch = pytest.importorskip("torch")

from models.somali_genre_classifier import (
    GENRE_LABELS,
    N_MEL_BINS,
    SomaliGenreClassifier,
)
from models.somali_scale_classifier import (
    SCALE_DEGREE_LABELS,
    WINDOW_SAMPLES,
    SomaliScaleClassifier,
)
from services.scale import SOMALI_SCALE_HZ


def test_genre_forward_shape_and_variable_length() -> None:
    model = SomaliGenreClassifier()
    for time_frames in (256, 700):  # variable-length spectrograms must both work
        logits = model(torch.randn(2, 1, N_MEL_BINS, time_frames))
        assert logits.shape == (2, len(GENRE_LABELS))


def test_genre_accepts_missing_channel_dim() -> None:
    model = SomaliGenreClassifier()
    logits = model(torch.randn(3, N_MEL_BINS, 300))
    assert logits.shape == (3, len(GENRE_LABELS))


def test_genre_predict_returns_known_labels() -> None:
    names, probs = SomaliGenreClassifier().predict(torch.randn(2, 1, N_MEL_BINS, 300))
    assert all(name in GENRE_LABELS for name in names)
    assert probs.shape == (2, len(GENRE_LABELS))
    assert torch.allclose(probs.sum(dim=-1), torch.ones(2), atol=1e-5)


def test_scale_labels_are_the_canonical_scale_plus_unvoiced() -> None:
    # The class vocabulary must be DERIVED from the production scale table —
    # a hand-typed copy could drift when the reference table is recalibrated.
    assert (*SOMALI_SCALE_HZ.keys(), "unvoiced") == SCALE_DEGREE_LABELS


def test_scale_forward_shape() -> None:
    model = SomaliScaleClassifier()
    logits = model(torch.randn(4, WINDOW_SAMPLES))
    assert logits.shape == (4, len(SCALE_DEGREE_LABELS))


def test_scale_accepts_explicit_channel_dim() -> None:
    logits = SomaliScaleClassifier()(torch.randn(2, 1, WINDOW_SAMPLES))
    assert logits.shape == (2, len(SCALE_DEGREE_LABELS))


def test_scale_model_stays_real_time_sized() -> None:
    # The mobile real-time constraint: budget well under a million parameters.
    assert SomaliScaleClassifier().parameter_count() < 500_000


def test_scale_predict_returns_known_labels() -> None:
    names, probs = SomaliScaleClassifier().predict(torch.randn(2, WINDOW_SAMPLES))
    assert all(name in SCALE_DEGREE_LABELS for name in names)
    assert torch.allclose(probs.sum(dim=-1), torch.ones(2), atol=1e-5)
