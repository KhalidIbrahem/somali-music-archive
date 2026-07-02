"""Unit tests for the Somali scale mapping — the research core (ARCHITECTURE.md §10).

Pure and dependency-light: these run in CI without torch/crepe/librosa.
"""

from __future__ import annotations

import math

import pytest

from services.scale import SOMALI_SCALE_HZ, hz_to_somali_note, map_pitch_frames


def test_exact_scale_pitch_has_zero_cents() -> None:
    for note, hz in SOMALI_SCALE_HZ.items():
        mapped_note, cents = hz_to_somali_note(hz)
        assert mapped_note == note
        assert cents == pytest.approx(0.0, abs=1e-6)


def test_quarter_tone_is_about_fifty_cents() -> None:
    # A quarter tone above D4 (293.66 Hz) is ~50 cents sharp.
    quarter_tone_up = 293.66 * math.pow(2, 50 / 1200)
    note, cents = hz_to_somali_note(quarter_tone_up)
    assert note == "do"
    assert cents == pytest.approx(50.0, abs=0.5)


def test_maps_to_nearest_degree() -> None:
    # Slightly below A4 (440) should snap to "sol" with a small negative deviation.
    note, cents = hz_to_somali_note(438.0)
    assert note == "sol"
    assert cents < 0


def test_non_positive_frequency_raises() -> None:
    with pytest.raises(ValueError):
        hz_to_somali_note(0.0)


def test_map_pitch_frames_filters_low_confidence_and_silence() -> None:
    frames = [
        (0.00, 293.66, 0.95),  # kept
        (0.01, 440.00, 0.50),  # dropped: below threshold
        (0.02, 0.0, 0.99),     # dropped: silence / no pitch
        (0.03, 493.88, 0.90),  # kept
    ]
    points = map_pitch_frames(frames, confidence_threshold=0.80)
    assert len(points) == 2
    assert points[0]["note_label"] == "do"
    assert points[1]["note_label"] == "la"
