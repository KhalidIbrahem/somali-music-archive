"""Unit tests for the corpus-analysis statistics (scripts/analyze_corpus.py).

These functions produce the ISMIR paper's headline numbers — known-answer
tests on synthetic deviation/frequency data, no disk or figures involved.
"""

from __future__ import annotations

import numpy as np
import pytest

from scripts.analyze_corpus import (
    DO_REFERENCE_HZ,
    PATTERN_CENTS,
    aligned_deviations,
    degree_statistics,
    era_comparison,
    fit_grid_offset,
    ornament_statistics,
    pitch_class_cents,
)


def _track(do: list[float], mi: list[float]) -> dict[str, list[float]]:
    return {"do": do, "re": [], "mi": mi, "sol": [], "la": []}


def _synthetic_track(
    offset_cents: float, dispersion_cents: float, n: int = 600, seed: int = 0
) -> np.ndarray:
    """Frames of a pentatonic performance transposed by `offset_cents` with
    gaussian intonation noise, spread over three octaves."""
    rng = np.random.default_rng(seed)
    degrees = rng.choice(PATTERN_CENTS, size=n)
    octaves = rng.choice([-1, 0, 1], size=n)
    cents = degrees + offset_cents + rng.normal(0, dispersion_cents, size=n)
    return DO_REFERENCE_HZ * np.power(2.0, (cents + 1200 * octaves) / 1200.0)


def test_degree_statistics_known_values() -> None:
    tracks = {
        "track_0001": _track(do=[10.0, -10.0], mi=[-30.0]),
        "track_0002": _track(do=[20.0], mi=[-50.0, -70.0]),
    }
    stats = degree_statistics(tracks)
    assert stats["n_tracks"] == 2
    assert stats["n_frames_total"] == 6
    do = stats["per_degree"]["do"]
    assert do["n_frames"] == 3
    assert do["mean_cents"] == pytest.approx(20 / 3, abs=0.01)
    assert do["mean_abs_cents"] == pytest.approx(40 / 3, abs=0.01)
    mi = stats["per_degree"]["mi"]
    assert mi["median_cents"] == -50.0
    # |−30|,|−50|,|−70| → two of three beyond the 50-cent quarter tone? −50 is
    # NOT beyond (strict >), so exactly one of three.
    assert mi["share_beyond_quarter_tone"] == pytest.approx(1 / 3, abs=1e-4)
    assert stats["per_degree"]["re"]["n_frames"] == 0


# ---------------------------------------------------------------------------
# Grid alignment
# ---------------------------------------------------------------------------


def test_fit_grid_offset_recovers_known_transposition() -> None:
    # A performance 150 cents above the D grid (≈ E♭, or a fast tape) must be
    # recovered as δ ≈ 150 regardless of octave placement.
    freqs = _synthetic_track(offset_cents=150.0, dispersion_cents=8.0)
    fit = fit_grid_offset(freqs)
    assert fit["offset_cents"] is not None
    assert min(abs(fit["offset_cents"] - 150.0), abs(fit["offset_cents"] - 150.0 + 1200)) < 10
    assert fit["concentration"] > 0.9


def test_fit_grid_offset_too_sparse_returns_none() -> None:
    fit = fit_grid_offset(_synthetic_track(0.0, 5.0, n=50))
    assert fit["offset_cents"] is None


def test_aligned_deviations_are_circular_and_small_on_grid() -> None:
    freqs = _synthetic_track(offset_cents=0.0, dispersion_cents=0.0)
    dev = aligned_deviations(pitch_class_cents(freqs), 0.0)
    assert np.abs(dev).max() < 1e-6
    # A frame 30 cents above "la"+offset must read +30 even across the octave wrap.
    hz = DO_REFERENCE_HZ * 2 ** ((900 + 30 + 1200) / 1200)
    dev = aligned_deviations(pitch_class_cents(np.array([hz])), 0.0)
    assert dev[0] == pytest.approx(30.0, abs=0.01)


def test_alignment_absorbs_tape_speed_offset() -> None:
    # Same performance, one at true speed and one played 4% fast (~ +68 cents):
    # fixed-grid deviations differ wildly, aligned dispersion must match.
    base = _synthetic_track(offset_cents=0.0, dispersion_cents=12.0, seed=3)
    fast = base * 1.04
    disp = []
    for freqs in (base, fast):
        fit = fit_grid_offset(freqs)
        dev = aligned_deviations(pitch_class_cents(freqs), fit["offset_cents"])
        disp.append(float(np.abs(dev).mean()))
    assert disp[0] == pytest.approx(disp[1], abs=1.5)


# ---------------------------------------------------------------------------
# Era comparison (aligned dispersion, track-level)
# ---------------------------------------------------------------------------


def test_era_comparison_detects_dispersion_difference() -> None:
    tracks: dict[str, np.ndarray] = {}
    years: dict[str, int] = {}
    for i in range(6):  # tight early tracks, in assorted keys
        tracks[f"track_{i:04d}"] = _synthetic_track(i * 90.0, 8.0, seed=i)
        years[f"track_{i:04d}"] = 1964
    for i in range(6, 12):  # sloppy late tracks
        tracks[f"track_{i:04d}"] = _synthetic_track(i * 90.0, 38.0, seed=i)
        years[f"track_{i:04d}"] = 1975
    era = era_comparison(tracks, years, split_year=1970)
    assert era["n_tracks_early"] == 6 and era["n_tracks_late"] == 6
    assert era["late_median_cents"] > era["early_median_cents"]
    assert era["p_value"] < 0.05


def test_era_comparison_empty_dated_subset() -> None:
    era = era_comparison({"track_0001": _synthetic_track(0.0, 5.0)}, {}, split_year=1970)
    assert era["n_tracks_early"] == 0 and era["n_tracks_late"] == 0
    assert era["early_median_cents"] is None


def test_ornament_statistics_rates_per_voiced_minute() -> None:
    summaries = {
        "track_0001": {
            "ornaments": {"vibrato": 6, "glissando": 3},
            "voiced_seconds": 90.0,
            "modal_center": "do",
        },
        "track_0002": {
            "ornaments": {"vibrato": 2},
            "voiced_seconds": 30.0,
            "modal_center": "sol",
        },
    }
    stats = ornament_statistics(summaries)
    assert stats["totals"] == {"vibrato": 8, "glissando": 3}
    assert stats["per_voiced_minute"]["vibrato"] == pytest.approx(8 / 2.0)
    assert stats["modal_center_distribution"] == {"do": 1, "sol": 1}
