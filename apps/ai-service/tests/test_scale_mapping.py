"""Unit tests for utils/scale_mapping — the canonical research import surface.

Guards two invariants: (1) the wrapper genuinely re-exports the production
scale from services/scale (no drift possible), and (2) fixed-degree cents
measurement behaves correctly, including where it must DISAGREE with
nearest-note snapping.
"""

from __future__ import annotations

import math

import pytest

from services import scale as production_scale
from utils.scale_mapping import (
    SOMALI_SCALE_HZ,
    calculate_cents_deviation,
    hz_to_somali_note,
    map_pitch_frames,
)


def test_reexports_are_the_production_objects() -> None:
    assert SOMALI_SCALE_HZ is production_scale.SOMALI_SCALE_HZ
    assert hz_to_somali_note is production_scale.hz_to_somali_note
    assert map_pitch_frames is production_scale.map_pitch_frames


def test_zero_deviation_on_reference_pitch() -> None:
    for degree, hz in SOMALI_SCALE_HZ.items():
        assert calculate_cents_deviation(hz, degree) == pytest.approx(0.0, abs=1e-6)


def test_quarter_tone_sharp_is_fifty_cents() -> None:
    quarter_up = SOMALI_SCALE_HZ["mi"] * math.pow(2, 50 / 1200)
    assert calculate_cents_deviation(quarter_up, "mi") == pytest.approx(50.0, abs=0.01)


def test_fixed_degree_differs_from_nearest_note_snapping() -> None:
    # 200 cents above "mi" (369.99) is ~415.3 Hz, which is NEARER to "sol" (440).
    # Nearest-note snapping relabels it; fixed-degree measurement must not.
    hz = SOMALI_SCALE_HZ["mi"] * math.pow(2, 200 / 1200)
    snapped_note, _ = hz_to_somali_note(hz)
    assert snapped_note == "sol"
    assert calculate_cents_deviation(hz, "mi") == pytest.approx(200.0, abs=0.01)


def test_octave_equivalence_bass_register_maps_cleanly() -> None:
    # D3 (146.83 Hz) and D5 (587.33 Hz) are both "do" at ~0 cents — male vocal
    # and oud bass registers must not smear onto the lowest degree with
    # hundreds of cents of spurious deviation.
    for hz in (146.83, 587.33):
        note, cents = hz_to_somali_note(hz)
        assert note == "do"
        assert abs(cents) < 1.0
    assert calculate_cents_deviation(146.83, "do") == pytest.approx(0.0, abs=1.0)


def test_deviation_never_exceeds_widest_gap_midpoint() -> None:
    # Pentatonic gaps are 200/200/300/200/300 cents → max |deviation| is 150.
    rng_hz = [55.0 * math.pow(2, i / 37) for i in range(200)]  # sweep 55–2300 Hz
    for hz in rng_hz:
        _, cents = hz_to_somali_note(hz)
        assert abs(cents) <= 150.0 + 1e-6


def test_non_positive_frequency_raises() -> None:
    with pytest.raises(ValueError):
        calculate_cents_deviation(0.0, "do")
    with pytest.raises(ValueError):
        calculate_cents_deviation(-440.0, "sol")


def test_unknown_degree_raises_key_error() -> None:
    with pytest.raises(KeyError):
        calculate_cents_deviation(440.0, "ti")
