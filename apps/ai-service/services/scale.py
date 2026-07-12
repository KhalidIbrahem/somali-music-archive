"""Somali pentatonic scale mapping (ARCHITECTURE.md §10).

This module is the *core research contribution* of the platform: mapping detected
pitches onto the Somali scale and quantifying microtonal deviation (in cents) from
Western equal temperament. It is deliberately pure (stdlib `math` only, no numpy)
so it is trivially unit-testable and has no heavy ML dependency — CI can verify the
science without installing torch/crepe.

IMPORTANT (from the spec): the reference frequencies are approximate and are to be
refined empirically from Ahmed Ali Egal's recordings — his ear is the ground truth.
Update `SOMALI_SCALE_HZ` as field data comes in.
"""

from __future__ import annotations

import math

# Somali pentatonic scale — approximate Hz (D root, common oud tuning).
SOMALI_SCALE_HZ: dict[str, float] = {
    "do": 293.66,  # D4
    "re": 329.63,  # E4
    "mi": 369.99,  # F#4 (approximate — slightly variable in practice)
    "sol": 440.00,  # A4
    "la": 493.88,  # B4
}


def _octave_folded_cents(hz: float, reference_hz: float) -> float:
    """Signed cents from ``reference_hz`` to ``hz`` folded to pitch class.

    Result is in [-600, +600): the same note played in any octave measures the
    same deviation. Octave equivalence is the standard convention in tuning
    analysis (cf. makam pitch histograms) and is essential here — male vocal
    lines and the oud's bass register sit an octave or more below the D4
    reference table, and absolute-Hz matching would smear them onto the lowest
    degree with meaningless deviations of hundreds of cents.
    """
    cents = 1200.0 * math.log2(hz / reference_hz)
    return (cents + 600.0) % 1200.0 - 600.0


def hz_to_somali_note(hz: float) -> tuple[str, float]:
    """Map a frequency to the nearest Somali scale degree (octave-equivalent).

    Returns ``(note_name, cents_deviation)`` where ``cents_deviation`` reveals
    microtonality:
      * 0 cents      = exactly on the equal-tempered pitch class,
      * ±50 cents    = a quarter tone away,
      * ±100 cents   = one semitone away.

    The mapping is by pitch *class*: 146.83 Hz (D3) maps to ``do`` at 0 cents,
    same as 293.66 Hz (D4). With the pentatonic gaps of this scale the largest
    possible deviation is ±150 cents (midpoint of a 300-cent gap).

    Raises ``ValueError`` for a non-positive frequency (cents are undefined there).
    """
    if hz <= 0:
        raise ValueError("frequency must be positive")

    note_name, cents_deviation = min(
        (
            (name, _octave_folded_cents(hz, reference_hz))
            for name, reference_hz in SOMALI_SCALE_HZ.items()
        ),
        key=lambda item: abs(item[1]),
    )
    return note_name, round(cents_deviation, 2)


def map_pitch_frames(
    frames: list[tuple[float, float, float]],
    confidence_threshold: float,
) -> list[dict[str, float | str]]:
    """Turn raw ``(time_sec, frequency_hz, confidence)`` frames into scale-mapped
    pitch points, dropping low-confidence and non-positive frames.

    Kept dependency-free so it composes with CREPE output (arrays converted to a
    list of tuples upstream) while remaining unit-testable on its own.
    """
    points: list[dict[str, float | str]] = []
    for time_sec, hz, confidence in frames:
        if confidence < confidence_threshold or hz <= 0:
            continue
        note, deviation = hz_to_somali_note(hz)
        points.append(
            {
                "time_sec": round(time_sec, 3),
                "frequency_hz": round(hz, 2),
                "confidence": round(confidence, 3),
                "note_label": note,
                "cents_deviation": deviation,
            }
        )
    return points
