"""Corpus-level analysis for the ISMIR paper (Phase D5 + Figures 1-2).

Aggregates every per-track artifact on disk (inventory, quality audits, pitch
JSONs) into the paper's empirical numbers and figures:

  * per-degree octave-folded cents-deviation distributions (Figure 1)
  * early-vs-late intonation comparison on date-stamped tracks (Figure 2)
  * corpus/quality/ornament/tempo summary statistics

Outputs:
    data/analysis/corpus_analysis.json   — every number the paper cites
    docs/figures/fig1_cents_histograms.png (+ .svg)
    docs/figures/fig3_era_comparison.png   (+ .svg)

Honesty rules: the script analyses whatever tracks have completed the pitch
stage and records `n` for every statistic; the era test uses per-TRACK means
as the independent samples (frames within a track are autocorrelated — frame
counts would fake precision), reporting a Mann-Whitney U test per degree.

Every figure is generated from the same JSON the paper cites — no hand-edited
numbers anywhere in the chain.

Usage:
    cd apps/ai-service
    python -m scripts.analyze_corpus            # analyse all completed tracks
    python -m scripts.analyze_corpus --no-figures
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from collections import Counter
from collections.abc import Sequence
from pathlib import Path
from typing import Any

_SERVICE_ROOT = Path(__file__).resolve().parent.parent
if str(_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(_SERVICE_ROOT))

import numpy as np

from scripts.process_harvard import PipelineConfig, default_config
from services.scale import SOMALI_SCALE_HZ

log = logging.getLogger("analyze_corpus")

DEGREES: tuple[str, ...] = tuple(SOMALI_SCALE_HZ.keys())
ERA_SPLIT_YEAR = 1970  # dated local tracks span 1964-1976; 1970 splits the arrival
# of heavy Western instrumentation (organ/electric guitar) per the era model.
QUARTER_TONE_CENTS = 50.0

# The anhemitonic pentatonic interval pattern in cents relative to its root:
# major-pentatonic spacing 200/200/300/200/300. Grid alignment fits WHERE this
# pattern sits per track; the fixed D-rooted table above is only its seed.
PATTERN_CENTS: tuple[float, ...] = (0.0, 200.0, 400.0, 700.0, 900.0)
DO_REFERENCE_HZ = SOMALI_SCALE_HZ["do"]
ALIGN_KERNEL_HALFWIDTH = 20  # cents; triangular smoothing for the alignment fit
MIN_FRAMES_FOR_ALIGNMENT = 300  # ~3 s of gated audio; below this δ is noise

# Validated categorical palette (dataviz skill reference instance, light mode).
SERIES_1 = "#2a78d6"  # slot 1 blue
SERIES_2 = "#1baf7a"  # slot 2 aqua
TEXT_PRIMARY = "#1a1a19"
TEXT_SECONDARY = "#5f5e56"
GRID = "#e5e4dc"


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


def load_track_frames(
    config: PipelineConfig,
) -> tuple[
    dict[str, dict[str, list[float]]],
    dict[str, dict[str, Any]],
    dict[str, np.ndarray],
]:
    """Read every completed pitch JSON.

    Returns:
        (deviations_by_track, summaries_by_track, frequencies_by_track):
        deviations_by_track maps track_id -> {degree -> [cents, ...]} on the
        FIXED D grid (as stored); frequencies_by_track carries the raw gated
        Hz values so the aligned-grid analysis can refit without re-running
        pitch extraction.
    """
    deviations: dict[str, dict[str, list[float]]] = {}
    summaries: dict[str, dict[str, Any]] = {}
    frequencies: dict[str, np.ndarray] = {}
    for path in sorted(config.pitch_dir.glob("*_pitch.json")):
        record = json.loads(path.read_text())
        track_id = str(record["track_id"])
        by_degree: dict[str, list[float]] = {d: [] for d in DEGREES}
        freqs: list[float] = []
        for pt in record.get("points", []):
            by_degree[str(pt["note_label"])].append(float(pt["cents_deviation"]))
            freqs.append(float(pt["frequency_hz"]))
        deviations[track_id] = by_degree
        frequencies[track_id] = np.asarray(freqs, dtype=np.float64)
        summaries[track_id] = {
            **record.get("summary", {}),
            "analyzed_source": record.get("analyzed_source"),
            "analyzed_sec": (record.get("excerpt") or {}).get("analyzed_sec"),
            "decoder": record.get("decoder"),
        }
    return deviations, summaries, frequencies


def load_quality(config: PipelineConfig) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for path in sorted(config.quality_dir.glob("*.json")):
        record = json.loads(path.read_text())
        out[str(record["track_id"])] = record
    return out


def load_inventory_years(config: PipelineConfig) -> dict[str, int]:
    """track_id -> recorded_year for the date-stamped subset."""
    import pandas as pd

    df = pd.read_csv(config.inventory_csv)
    dated = df[df["recorded_year"].notna()]
    return {str(r["track_id"]): int(r["recorded_year"]) for _, r in dated.iterrows()}


# ---------------------------------------------------------------------------
# Per-track grid alignment (the tape-speed / key-transposition defence)
# ---------------------------------------------------------------------------
#
# Why this exists (reviewer-panel findings, all upheld):
#   1. A fixed absolute reference grid (D-rooted) measures nothing for a song
#      performed in any other key — its deviations are key distance, not tuning.
#   2. Cassette playback-speed error shifts every pitch on a tape by one
#      constant cents offset, which a fixed-grid statistic absorbs one-for-one.
#   3. The grid's Hz values ARE 12-TET D-major pentatonic, so "deviation from
#      the grid" and "deviation from 12-TET" were the same number by
#      construction.
# Fitting a per-track offset δ that best aligns the observed pitch-class
# histogram to the pentatonic *interval pattern* absorbs key, speed, and A440
# in one parameter; what remains — deviation from the aligned grid — is the
# track's interval structure relative to equal temperament, which is the
# quantity the paper actually claims to measure.


def pitch_class_cents(frequencies_hz: np.ndarray) -> np.ndarray:
    """Frequencies → pitch-class position in [0, 1200) cents above the D ref."""
    return (1200.0 * np.log2(frequencies_hz / DO_REFERENCE_HZ)) % 1200.0


def fit_grid_offset(frequencies_hz: np.ndarray) -> dict[str, Any]:
    """Fit the offset δ (cents) placing the pentatonic pattern under the data.

    Builds a 1-cent pitch-class histogram, smooths it with a triangular kernel
    (half-width ALIGN_KERNEL_HALFWIDTH), and picks the circular shift of
    PATTERN_CENTS with the greatest mass under its five degrees. Returns the
    offset, an alignment concentration score (share of frames within ±50 cents
    of an aligned degree), and the frame count.

    Caveat recorded for the paper: the fit identifies the pattern's POSITION,
    not which degree is the tonic — the five modal rotations of the pattern
    are distinct but correlated, so cross-track degree labels from alignment
    carry mode ambiguity. Track-level dispersion statistics are immune to it.
    """
    n = int(frequencies_hz.size)
    if n < MIN_FRAMES_FOR_ALIGNMENT:
        return {"offset_cents": None, "concentration": None, "n_frames": n}
    pc = pitch_class_cents(frequencies_hz)
    hist, _ = np.histogram(pc, bins=1200, range=(0.0, 1200.0))
    k = ALIGN_KERNEL_HALFWIDTH
    kernel = 1.0 - np.abs(np.arange(-k, k + 1)) / (k + 1)
    smooth = np.convolve(np.tile(hist, 3).astype(np.float64), kernel, mode="same")[
        1200:2400
    ]
    offsets = np.arange(1200)
    scores = np.zeros(1200)
    for p in PATTERN_CENTS:
        scores += smooth[(offsets + int(p)) % 1200]
    delta = int(np.argmax(scores))

    aligned_dev = aligned_deviations(pc, float(delta))
    concentration = float(np.mean(np.abs(aligned_dev) <= QUARTER_TONE_CENTS))
    return {
        "offset_cents": float(delta),
        "concentration": round(concentration, 4),
        "n_frames": n,
    }


def aligned_deviations(pc: np.ndarray, offset_cents: float) -> np.ndarray:
    """Signed cents from each pitch-class frame to its nearest aligned degree."""
    degrees = (np.asarray(PATTERN_CENTS) + offset_cents) % 1200.0
    diff = pc[:, None] - degrees[None, :]
    diff = (diff + 600.0) % 1200.0 - 600.0  # circular signed distance
    nearest = np.argmin(np.abs(diff), axis=1)
    return diff[np.arange(len(pc)), nearest]


def aligned_track_statistics(
    frequencies_by_track: dict[str, np.ndarray],
) -> dict[str, Any]:
    """Per-track aligned-grid statistics + the corpus-level roll-up.

    The headline scalar per track is mean |aligned deviation| — intonation
    dispersion around the track's own fitted pentatonic grid — which is
    invariant to key, playback speed, and rotation ambiguity.
    """
    per_track: dict[str, Any] = {}
    for track_id, freqs in frequencies_by_track.items():
        fit = fit_grid_offset(freqs)
        if fit["offset_cents"] is None:
            per_track[track_id] = fit
            continue
        dev = aligned_deviations(pitch_class_cents(freqs), fit["offset_cents"])
        per_track[track_id] = {
            **fit,
            "mean_abs_dev_cents": round(float(np.abs(dev).mean()), 2),
            "median_abs_dev_cents": round(float(np.median(np.abs(dev))), 2),
            "share_beyond_quarter_tone": round(
                float(np.mean(np.abs(dev) > QUARTER_TONE_CENTS)), 4
            ),
            "offset_vs_d_grid_mod100": round(fit["offset_cents"] % 100.0, 1),
        }
    fitted = [t for t in per_track.values() if t.get("offset_cents") is not None]
    dispersions = [t["mean_abs_dev_cents"] for t in fitted]
    concentrations = [t["concentration"] for t in fitted]
    return {
        "n_tracks_fitted": len(fitted),
        "n_tracks_too_sparse": len(per_track) - len(fitted),
        "track_dispersion_cents": {
            "mean": round(float(np.mean(dispersions)), 2) if dispersions else None,
            "median": round(float(np.median(dispersions)), 2) if dispersions else None,
            "p10": round(float(np.percentile(dispersions, 10)), 2) if dispersions else None,
            "p90": round(float(np.percentile(dispersions, 90)), 2) if dispersions else None,
        },
        "alignment_concentration": {
            "median": round(float(np.median(concentrations)), 4) if concentrations else None,
        },
        "per_track": per_track,
    }


# ---------------------------------------------------------------------------
# Statistics (pure, unit-testable)
# ---------------------------------------------------------------------------


def degree_statistics(
    deviations_by_track: dict[str, dict[str, list[float]]],
) -> dict[str, Any]:
    """Pooled per-degree deviation stats + overall microtonality measures."""
    pooled: dict[str, list[float]] = {d: [] for d in DEGREES}
    for by_degree in deviations_by_track.values():
        for degree, values in by_degree.items():
            pooled[degree].extend(values)

    per_degree: dict[str, Any] = {}
    all_devs: list[float] = []
    for degree in DEGREES:
        values = np.asarray(pooled[degree], dtype=np.float64)
        all_devs.extend(pooled[degree])
        if values.size == 0:
            per_degree[degree] = {"n_frames": 0}
            continue
        per_degree[degree] = {
            "n_frames": int(values.size),
            "mean_cents": round(float(values.mean()), 2),
            "median_cents": round(float(np.median(values)), 2),
            "std_cents": round(float(values.std()), 2),
            "mean_abs_cents": round(float(np.abs(values).mean()), 2),
            "share_beyond_quarter_tone": round(
                float(np.mean(np.abs(values) > QUARTER_TONE_CENTS)), 4
            ),
        }
    arr = np.asarray(all_devs, dtype=np.float64)
    return {
        "per_degree": per_degree,
        "n_frames_total": int(arr.size),
        "n_tracks": len(deviations_by_track),
        "mean_abs_cents_overall": round(float(np.abs(arr).mean()), 2) if arr.size else None,
        "median_abs_cents_overall": (
            round(float(np.median(np.abs(arr))), 2) if arr.size else None
        ),
        "share_beyond_quarter_tone_overall": (
            round(float(np.mean(np.abs(arr) > QUARTER_TONE_CENTS)), 4) if arr.size else None
        ),
    }


def era_comparison(
    frequencies_by_track: dict[str, np.ndarray],
    years_by_track: dict[str, int],
    split_year: int = ERA_SPLIT_YEAR,
) -> dict[str, Any]:
    """Early-vs-late intonation on the date-stamped subset (Phase D5).

    Design notes (each a hard-won reviewer finding):
      * Statistic: per-track mean |aligned deviation| — dispersion around the
        track's OWN fitted pentatonic grid. Invariant to key transposition,
        cassette playback-speed offset, and pattern-rotation ambiguity, so a
        difference between eras is about interval structure, not tape decks.
      * Unit of analysis: the track (independent samples); frame-level tests
        would pseudo-replicate autocorrelated data.
      * Only date-STAMPED tracks enter — never instrumentation-predicted eras,
        which would be circular for an instrumentation-era hypothesis.
    """
    try:
        from scipy import stats
    except ImportError:
        stats = None

    def dispersion(track_id: str) -> float | None:
        freqs = frequencies_by_track.get(track_id)
        if freqs is None:
            return None
        fit = fit_grid_offset(freqs)
        if fit["offset_cents"] is None:
            return None
        dev = aligned_deviations(pitch_class_cents(freqs), fit["offset_cents"])
        return float(np.abs(dev).mean())

    early = {
        t: d
        for t, y in years_by_track.items()
        if y < split_year and (d := dispersion(t)) is not None
    }
    late = {
        t: d
        for t, y in years_by_track.items()
        if y >= split_year and (d := dispersion(t)) is not None
    }
    result: dict[str, Any] = {
        "statistic": "per-track mean |aligned deviation| (cents)",
        "split_year": split_year,
        "n_tracks_early": len(early),
        "n_tracks_late": len(late),
        "early_years": sorted({years_by_track[t] for t in early}),
        "late_years": sorted({years_by_track[t] for t in late}),
        "early_dispersions": {t: round(d, 2) for t, d in sorted(early.items())},
        "late_dispersions": {t: round(d, 2) for t, d in sorted(late.items())},
        "early_median_cents": round(float(np.median(list(early.values()))), 2)
        if early
        else None,
        "late_median_cents": round(float(np.median(list(late.values()))), 2)
        if late
        else None,
    }
    if stats is not None and len(early) >= 3 and len(late) >= 3:
        u, p = stats.mannwhitneyu(
            list(early.values()), list(late.values()), alternative="two-sided"
        )
        result["mannwhitney_u"] = round(float(u), 1)
        result["p_value"] = round(float(p), 4)
    return result


def ornament_statistics(summaries: dict[str, dict[str, Any]]) -> dict[str, Any]:
    totals: Counter[str] = Counter()
    voiced_minutes = 0.0
    for s in summaries.values():
        for kind, count in (s.get("ornaments") or {}).items():
            totals[kind] += int(count)
        voiced_minutes += float(s.get("voiced_seconds") or 0.0) / 60.0
    return {
        "totals": dict(totals),
        "voiced_hours_analyzed": round(voiced_minutes / 60.0, 2),
        "per_voiced_minute": {
            k: round(v / voiced_minutes, 2) for k, v in totals.items()
        }
        if voiced_minutes > 0
        else {},
        "modal_center_distribution": dict(
            Counter(s.get("modal_center") for s in summaries.values() if s.get("modal_center"))
        ),
    }


def quality_statistics(quality: dict[str, dict[str, Any]]) -> dict[str, Any]:
    snrs = [q["snr_estimate_db"] for q in quality.values() if "snr_estimate_db" in q]
    arr = np.asarray(snrs, dtype=np.float64)
    return {
        "n_tracks": len(quality),
        "snr_db": {
            "mean": round(float(arr.mean()), 2),
            "median": round(float(np.median(arr)), 2),
            "p10": round(float(np.percentile(arr, 10)), 2),
            "p90": round(float(np.percentile(arr, 90)), 2),
            "below_15db_count": int(np.sum(arr < 15.0)),
        }
        if arr.size
        else {},
        "clipped_tracks": sum(1 for q in quality.values() if q.get("is_clipped")),
    }


# ---------------------------------------------------------------------------
# Figures
# ---------------------------------------------------------------------------


def _style_axis(ax: Any) -> None:
    ax.spines[["top", "right"]].set_visible(False)
    ax.spines[["left", "bottom"]].set_color(GRID)
    ax.tick_params(colors=TEXT_SECONDARY, labelsize=8)
    ax.grid(axis="y", color=GRID, linewidth=0.6)
    ax.set_axisbelow(True)


def figure_cents_histograms(
    deviations_by_track: dict[str, dict[str, list[float]]],
    stats: dict[str, Any],
    out_dir: Path,
) -> list[Path]:
    """Figure 1 — per-degree octave-folded deviation histograms (small multiples)."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    pooled: dict[str, list[float]] = {d: [] for d in DEGREES}
    for by_degree in deviations_by_track.values():
        for degree, values in by_degree.items():
            pooled[degree].extend(values)

    fig, axes = plt.subplots(1, len(DEGREES), figsize=(11, 2.6), sharey=True)
    bins = np.arange(-150, 151, 10)
    for ax, degree in zip(axes, DEGREES, strict=True):
        values = np.asarray(pooled[degree])
        ax.hist(values, bins=bins, color=SERIES_1, edgecolor="white", linewidth=0.4)
        ax.axvline(0, color=TEXT_SECONDARY, linewidth=0.8, linestyle=":")
        per = stats["per_degree"][degree]
        median = per.get("median_cents")
        if median is not None:
            ax.axvline(median, color=TEXT_PRIMARY, linewidth=1.2)
            ax.set_title(
                f"{degree}   median {median:+.0f}¢",
                fontsize=9,
                color=TEXT_PRIMARY,
            )
        else:
            ax.set_title(degree, fontsize=9, color=TEXT_PRIMARY)
        ax.set_xlabel("cents from 12-TET", fontsize=8, color=TEXT_SECONDARY)
        _style_axis(ax)
    axes[0].set_ylabel("voiced frames", fontsize=8, color=TEXT_SECONDARY)
    fig.suptitle(
        f"Octave-folded deviation from the 12-TET reference per scale degree "
        f"(n = {stats['n_frames_total']:,} frames, {stats['n_tracks']} tracks)",
        fontsize=10,
        color=TEXT_PRIMARY,
    )
    fig.tight_layout(rect=(0, 0, 1, 0.93))
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = [out_dir / "fig1_cents_histograms.png", out_dir / "fig1_cents_histograms.svg"]
    for p in paths:
        fig.savefig(p, dpi=300, bbox_inches="tight")
    plt.close(fig)
    return paths


def figure_era_comparison(era: dict[str, Any], out_dir: Path) -> list[Path]:
    """Figure 3 — per-track aligned dispersion, early vs late (dot strip).

    A dot per track (n is small — showing every point is more honest than
    bars), with group medians as horizontal rules.
    """
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    groups = [
        (
            f"early ({min(era['early_years'])}–{max(era['early_years'])})",
            list(era["early_dispersions"].values()),
            SERIES_1,
            "o",
        ),
        (
            f"late ({min(era['late_years'])}–{max(era['late_years'])})",
            list(era["late_dispersions"].values()),
            SERIES_2,
            "s",
        ),
    ]
    fig, ax = plt.subplots(figsize=(5.2, 3.4))
    rng = np.random.default_rng(7)
    for i, (label, values, color, marker) in enumerate(groups):
        jitter = rng.uniform(-0.07, 0.07, size=len(values))
        ax.scatter(
            np.full(len(values), i) + jitter,
            values,
            s=42,
            color=color,
            marker=marker,
            edgecolor="white",
            linewidth=0.8,
            zorder=3,
            label=label,
        )
        median = float(np.median(values))
        ax.hlines(median, i - 0.2, i + 0.2, color=TEXT_PRIMARY, linewidth=1.6, zorder=4)
        ax.annotate(
            f"median {median:.0f}¢",
            (i + 0.24, median),
            va="center",
            fontsize=8,
            color=TEXT_PRIMARY,
        )
    p_text = (
        f"Mann–Whitney p = {era['p_value']}" if era.get("p_value") is not None else ""
    )
    ax.set_xticks([0, 1], [g[0] for g in groups])
    ax.set_xlim(-0.5, 1.75)
    ax.set_ylabel("per-track mean |aligned deviation| (cents)", fontsize=8, color=TEXT_SECONDARY)
    ax.set_title(
        f"Intonation dispersion by era — date-stamped tracks only "
        f"(n = {era['n_tracks_early']}+{era['n_tracks_late']}). {p_text}",
        fontsize=9.5,
        color=TEXT_PRIMARY,
    )
    _style_axis(ax)
    fig.tight_layout()
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = [out_dir / "fig3_era_comparison.png", out_dir / "fig3_era_comparison.svg"]
    for p in paths:
        fig.savefig(p, dpi=300, bbox_inches="tight")
    plt.close(fig)
    return paths


def figure_aligned_histogram(
    frequencies_by_track: dict[str, np.ndarray],
    aligned: dict[str, Any],
    out_dir: Path,
) -> list[Path]:
    """Figure 2 — pooled deviation histogram AFTER per-track grid alignment.

    The tightness of this distribution (vs the fixed-grid smear of Fig. 1) is
    the visual argument that per-track alignment is measuring a real tuning
    system rather than key/tape-speed noise.
    """
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    pooled: list[np.ndarray] = []
    for track_id, freqs in frequencies_by_track.items():
        fit = aligned["per_track"].get(track_id, {})
        if fit.get("offset_cents") is None:
            continue
        pooled.append(aligned_deviations(pitch_class_cents(freqs), fit["offset_cents"]))
    values = np.concatenate(pooled) if pooled else np.array([])

    fig, ax = plt.subplots(figsize=(6.0, 3.0))
    ax.hist(
        values,
        bins=np.arange(-150, 151, 5),
        color=SERIES_1,
        edgecolor="white",
        linewidth=0.3,
    )
    for x, style in ((0, "-"), (-50, ":"), (50, ":")):
        ax.axvline(x, color=TEXT_SECONDARY, linewidth=0.9, linestyle=style)
    ax.annotate("±quarter tone", (52, ax.get_ylim()[1] * 0.9), fontsize=8, color=TEXT_SECONDARY)
    share = float(np.mean(np.abs(values) > QUARTER_TONE_CENTS)) if values.size else 0.0
    ax.set_xlabel("cents from nearest aligned scale degree", fontsize=8, color=TEXT_SECONDARY)
    ax.set_ylabel("voiced frames", fontsize=8, color=TEXT_SECONDARY)
    ax.set_title(
        f"Deviation after per-track grid alignment "
        f"(n = {values.size:,} frames, {aligned['n_tracks_fitted']} tracks; "
        f"{share:.1%} beyond a quarter tone)",
        fontsize=9.5,
        color=TEXT_PRIMARY,
    )
    _style_axis(ax)
    fig.tight_layout()
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = [out_dir / "fig2_aligned_histogram.png", out_dir / "fig2_aligned_histogram.svg"]
    for p in paths:
        fig.savefig(p, dpi=300, bbox_inches="tight")
    plt.close(fig)
    return paths


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def run_analysis(config: PipelineConfig, make_figures: bool = True) -> dict[str, Any]:
    deviations, summaries, frequencies = load_track_frames(config)
    if not deviations:
        raise SystemExit(f"no pitch data in {config.pitch_dir} — run the pitch stage first")
    years = load_inventory_years(config)
    quality = load_quality(config)

    stats = degree_statistics(deviations)
    aligned = aligned_track_statistics(frequencies)
    era = era_comparison(frequencies, years)
    sources = Counter(s.get("analyzed_source") for s in summaries.values())
    tempos = [s["tempo_bpm"] for s in summaries.values() if s.get("tempo_bpm")]
    # Confidence-gate retention: how much of the analyzed audio survived the
    # 0.80 gate (reviewer finding — the gate's selection bias must be visible).
    retention = [
        s["n_pitch_points"] / (float(s["analyzed_sec"]) * 100.0)
        for s in summaries.values()
        if s.get("analyzed_sec") and s.get("n_pitch_points") is not None
    ]
    analysis: dict[str, Any] = {
        "corpus": {
            "n_tracks_pitch_analyzed": len(deviations),
            "analyzed_source_counts": dict(sources),
            "decoders": dict(Counter(s.get("decoder") for s in summaries.values())),
            "n_tracks_quality_audited": len(quality),
            "n_dated_tracks": len(years),
            "dated_year_range": [min(years.values()), max(years.values())] if years else None,
            "confidence_gate_retention": {
                "median": round(float(np.median(retention)), 4) if retention else None,
                "p10": round(float(np.percentile(retention, 10)), 4) if retention else None,
                "p90": round(float(np.percentile(retention, 90)), 4) if retention else None,
            },
        },
        "scale_reference_hz": SOMALI_SCALE_HZ,
        "fixed_grid_degree_statistics": stats,
        "aligned_grid_statistics": aligned,
        "era_comparison": era,
        "ornaments": ornament_statistics(summaries),
        "quality": quality_statistics(quality),
        "tempo_bpm": {
            "n": len(tempos),
            "median": round(float(np.median(tempos)), 1) if tempos else None,
            "p10": round(float(np.percentile(tempos, 10)), 1) if tempos else None,
            "p90": round(float(np.percentile(tempos, 90)), 1) if tempos else None,
        },
    }

    out_dir = config.data_root / "analysis"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "corpus_analysis.json"
    out_path.write_text(json.dumps(analysis, indent=2))
    log.info("analysis → %s", out_path)

    if make_figures:
        figures_dir = _SERVICE_ROOT.parent.parent / "docs" / "figures"
        paths = figure_cents_histograms(deviations, stats, figures_dir)
        paths += figure_aligned_histogram(frequencies, aligned, figures_dir)
        if era.get("early_dispersions") and era.get("late_dispersions"):
            paths += figure_era_comparison(era, figures_dir)
        else:
            log.warning("era figure skipped — a stratum has no fitted dated tracks")
        for p in paths:
            log.info("figure → %s", p)
    return analysis


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-figures", action="store_true")
    parser.add_argument("--data-root", type=Path, default=None)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
    config = default_config()
    if args.data_root:
        config = PipelineConfig(
            data_root=args.data_root,
            audio_dirs=config.audio_dirs,
            catalog_csv=config.catalog_csv,
        )
    run_analysis(config, make_figures=not args.no_figures)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
