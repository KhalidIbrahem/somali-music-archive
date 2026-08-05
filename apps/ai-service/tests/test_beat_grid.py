"""Beat-tracked grid mapping (scripts/beat_grid.py) — pure numpy, any Python."""

from __future__ import annotations

import numpy as np
import pytest

from scripts.beat_grid import (
    MIN_BEATS_FOR_GRID,
    median_bpm,
    snap_notes_to_beats,
    times_to_beats,
)


def test_uniform_beats_map_linearly() -> None:
    beats = np.array([0.0, 0.5, 1.0, 1.5, 2.0])  # steady 120 BPM
    out = times_to_beats([0.0, 0.25, 1.0, 1.75], beats)
    assert np.allclose(out, [0.0, 0.5, 2.0, 3.5])


def test_rubato_notes_on_beats_land_on_integers() -> None:
    # Accelerating performance — intervals 1.0, 0.9, 0.8, 0.7 s. A fixed grid
    # drifts progressively; the beat axis keeps every on-beat note integral.
    beats = np.array([0.0, 1.0, 1.9, 2.7, 3.4])
    out = times_to_beats(beats, beats)
    assert np.allclose(out, np.arange(len(beats)))

    offsets, _ = snap_notes_to_beats(beats, beats + 0.1, beats)
    assert np.allclose(offsets, np.arange(len(beats)))


def test_extrapolates_past_both_edges() -> None:
    beats = np.array([1.0, 2.0, 3.0])
    out = times_to_beats([0.5, 3.5], beats)
    assert np.allclose(out, [-0.5, 2.5])


def test_snap_clamps_pickup_to_zero_and_floors_duration() -> None:
    beats = np.array([1.0, 2.0, 3.0, 4.0])
    offsets, durations = snap_notes_to_beats([0.2], [0.21], beats)
    assert offsets[0] == 0.0  # pickup before beat 0 cannot go negative
    assert durations[0] == 0.25  # zero-length notes keep one subdivision


def test_snap_quantizes_to_quarter_beats() -> None:
    beats = np.array([0.0, 1.0, 2.0, 3.0])
    offsets, durations = snap_notes_to_beats([0.6, 1.1], [1.1, 2.4], beats)
    assert np.allclose(offsets, [0.5, 1.0])
    assert np.allclose(durations, [0.5, 1.25])


def test_median_bpm_ignores_outlier_gap() -> None:
    beats = np.array([0.0, 0.5, 1.0, 1.5, 3.5])  # one dropped-beat gap
    assert median_bpm(beats) == pytest.approx(120.0)


def test_too_few_beats_raises() -> None:
    with pytest.raises(ValueError):
        times_to_beats([1.0], np.array([2.0]))
    assert MIN_BEATS_FOR_GRID >= 2
