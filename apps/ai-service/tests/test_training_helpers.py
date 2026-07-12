"""Unit tests for the pure helpers in scripts/train_somali_model.py."""

from __future__ import annotations

import numpy as np
import pytest

from models.somali_genre_classifier import GENRE_LABELS
from scripts.train_somali_model import (
    assign_split,
    augment_scale_waveform,
    encode_labels,
    label_windows_from_points,
    split_key_for,
)


def test_assign_split_is_deterministic_and_roughly_80_20() -> None:
    ids = [f"track_{i:04d}" for i in range(1, 606)]
    first = [assign_split(t) for t in ids]
    second = [assign_split(t) for t in ids]
    assert first == second  # stable across calls (and processes, by design)
    train_fraction = first.count("train") / len(first)
    assert 0.72 <= train_fraction <= 0.88  # hash noise, but near 80/20


def test_split_key_groups_by_cassette_when_known() -> None:
    # Two tracks on the same cassette must share a split key — a cassette
    # shares tape generation and deck, so it must never straddle train/val.
    assert split_key_for("track_0001", 12) == split_key_for("track_0002", 12.0)
    assert split_key_for("track_0001", None) == "track_0001"
    assert assign_split(split_key_for("track_0001", 12)) == assign_split(
        split_key_for("track_0009", 12)
    )


def test_encode_labels_round_trip_and_typo_rejection() -> None:
    assert encode_labels(["qaraami", "heello"], GENRE_LABELS) == [1, 0]
    with pytest.raises(ValueError, match="qaraami_typo"):
        encode_labels(["qaraami_typo"], GENRE_LABELS)


def _voiced_points(start: float, seconds: float, note: str) -> list[dict[str, float | str]]:
    """Fully-voiced CREPE-style points at 100 frames/s for `seconds` from `start`."""
    return [
        {"time_sec": round(start + i * 0.01, 3), "note_label": note, "cents_deviation": 0.0}
        for i in range(int(seconds * 100))
    ]


def test_label_windows_confident_degree_and_unvoiced() -> None:
    # 1 s solid "sol", then 1 s of silence (no points).
    points = _voiced_points(0.0, 1.0, "sol")
    labelled = dict(label_windows_from_points(points, duration_sec=2.0))
    assert labelled[0.0] == "sol"
    assert labelled[1.0] == "unvoiced"


def test_label_windows_drops_ambiguous_windows() -> None:
    # Window 0: half "do", half "sol" — fought over, must be DROPPED.
    points = _voiced_points(0.0, 0.5, "do") + _voiced_points(0.5, 0.5, "sol")
    labelled = label_windows_from_points(points, duration_sec=1.0)
    assert labelled == []


def test_label_windows_drops_sparsely_voiced_windows() -> None:
    # 30% voiced: too voiced for `unvoiced`, too sparse for a degree label.
    points = _voiced_points(0.0, 0.3, "la")
    labelled = label_windows_from_points(points, duration_sec=1.0)
    assert labelled == []


def test_augment_scale_waveform_preserves_shape_and_range() -> None:
    rng = np.random.default_rng(7)
    window = 0.5 * np.sin(np.linspace(0, 100, 16000)).astype(np.float32)
    out = augment_scale_waveform(window, rng)
    assert out.shape == window.shape
    assert out.dtype == np.float32
    assert float(np.abs(out).max()) <= 1.0
