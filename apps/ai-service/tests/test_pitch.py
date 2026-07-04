"""Unit tests for the pitch analytics pipeline (SESSION P3-02).

CREPE is never invoked — synthetic frame arrays stand in for its output, built
from the canonical scale table so expected cents values are exact by
construction. Dependency-light like the rest of the suite.
"""

from __future__ import annotations

import pytest

from services.pitch_service import (
    DOMINANT_NOTE_MIN_SHARE,
    PitchResult,
    dominant_notes,
    extract_pitch,
    note_statistics,
)
from services.scale import SOMALI_SCALE_HZ


def hz_at(note: str, cents: float) -> float:
    """Frequency exactly `cents` away from a scale degree — exact by construction."""
    return SOMALI_SCALE_HZ[note] * 2 ** (cents / 1200)


def run(
    frames: list[tuple[str | None, float, float]],
    threshold: float = 0.8,
) -> PitchResult:
    """Build CREPE-shaped arrays from (note, cents, confidence) specs and extract.

    ``note=None`` produces an unvoiced (0 Hz) frame — CREPE's silence output.
    Frame times step by 0.5 s so durations are easy to assert.
    """
    times = [i * 0.5 for i in range(len(frames))]
    freqs = [hz_at(note, cents) if note else 0.0 for note, cents, _ in frames]
    confs = [conf for _, _, conf in frames]
    return extract_pitch(times, freqs, confs, confidence_threshold=threshold)


# ── extract_pitch: filtering, mapping, honesty metrics ────────────────────────


def test_confident_frames_map_to_scale_degrees_with_cents() -> None:
    result = run([("do", 0.0, 0.95), ("mi", -20.0, 0.9)])

    assert [p["note_label"] for p in result.pitch_data] == ["do", "mi"]
    assert float(result.pitch_data[0]["cents_deviation"]) == pytest.approx(0.0, abs=0.01)
    assert float(result.pitch_data[1]["cents_deviation"]) == pytest.approx(-20.0, abs=0.01)


def test_low_confidence_and_silence_reduce_voiced_fraction() -> None:
    # 4 frames: one below threshold, one silent → 2 of 4 voiced.
    result = run([("do", 0.0, 0.95), ("do", 0.0, 0.5), (None, 0.0, 0.99), ("la", 5.0, 0.9)])

    assert len(result.pitch_data) == 2
    assert result.voiced_fraction == 0.5


def test_duration_comes_from_the_frame_grid_not_the_kept_points() -> None:
    # Last frame is silent — duration must still cover the whole clip.
    result = run([("do", 0.0, 0.95), ("do", 0.0, 0.95), (None, 0.0, 0.1)])
    assert result.duration_sec == 1.0  # 3 frames at 0.5 s steps → last time 1.0


def test_empty_input_yields_empty_result() -> None:
    result = extract_pitch([], [], [], confidence_threshold=0.8)
    assert result.pitch_data == []
    assert result.dominant_notes == []
    assert result.note_statistics == {}
    assert result.voiced_fraction == 0.0
    assert result.duration_sec == 0.0


def test_all_frames_below_threshold_yields_no_statistics() -> None:
    result = run([("do", 0.0, 0.3), ("mi", 0.0, 0.2)])
    assert result.pitch_data == []
    assert result.note_statistics == {}
    assert result.voiced_fraction == 0.0


# ── note_statistics: the microtonal fingerprint ───────────────────────────────


def test_mean_cents_per_degree_is_the_average_deviation() -> None:
    result = run([("mi", -10.0, 0.9), ("mi", -20.0, 0.9), ("do", 0.0, 0.9)])

    assert result.note_statistics["mi"]["mean_cents"] == pytest.approx(-15.0, abs=0.05)
    assert result.note_statistics["mi"]["count"] == 2.0
    assert result.note_statistics["do"]["mean_cents"] == pytest.approx(0.0, abs=0.05)


def test_share_is_confidence_weighted() -> None:
    # do carries 0.9+0.9=1.8 of the weight, la 0.85 → shares 1.8/2.65 and 0.85/2.65.
    result = run([("do", 0.0, 0.9), ("do", 0.0, 0.9), ("la", 0.0, 0.85)])

    assert result.note_statistics["do"]["share"] == pytest.approx(0.679, abs=0.001)
    assert result.note_statistics["la"]["share"] == pytest.approx(0.321, abs=0.001)


def test_statistics_of_no_points_is_empty() -> None:
    assert note_statistics([]) == {}


# ── dominant_notes: melodic skeleton extraction ───────────────────────────────


def test_dominant_notes_ordered_by_prevalence() -> None:
    result = run([("sol", 0.0, 0.9)] * 3 + [("do", 0.0, 0.9)] * 2 + [("la", 0.0, 0.9)])
    assert result.dominant_notes == ["sol", "do", "la"]


def test_marginal_degrees_are_dropped_as_ornamentation() -> None:
    # 24 do-frames vs 1 la-frame → la share = 1/25 = 4% < 5% floor.
    result = run([("do", 0.0, 1.0)] * 24 + [("la", 0.0, 1.0)])
    assert result.dominant_notes == ["do"]


def test_dominance_threshold_is_configurable() -> None:
    stats = {"do": {"share": 0.96, "mean_cents": 0.0, "count": 24.0},
             "la": {"share": 0.04, "mean_cents": 0.0, "count": 1.0}}
    assert dominant_notes(stats, min_share=0.03) == ["do", "la"]
    assert dominant_notes(stats, min_share=DOMINANT_NOTE_MIN_SHARE) == ["do"]


# ── Wire contract ─────────────────────────────────────────────────────────────


def test_payload_matches_storage_contract() -> None:
    payload = run([("do", 0.0, 0.9)]).to_payload()
    assert set(payload) == {
        "pitch_data",
        "dominant_notes",
        "note_statistics",
        "voiced_fraction",
        "duration_sec",
    }
