"""Canonical import surface for the Somali scale mapping.

Research code (notebooks, scripts/, evaluation/) is documented to import the
Somali scale from ``utils.scale_mapping``. The actual science lives in
``services/scale.py`` — the pure, unit-tested module the FastAPI service uses
in production. This wrapper re-exports it so there is exactly ONE definition
of the scale: a notebook and the live API can never drift apart on what
"do" means in Hz.

Adds :func:`calculate_cents_deviation` for callers that already know which
scale degree they are measuring against (e.g. the per-degree deviation
histograms in the ISMIR analysis), where nearest-note snapping would be wrong.
"""

from __future__ import annotations

import math

from services.scale import (
    SOMALI_SCALE_HZ,
    hz_to_somali_note,
    map_pitch_frames,
)

__all__ = [
    "SOMALI_SCALE_HZ",
    "calculate_cents_deviation",
    "hz_to_somali_note",
    "map_pitch_frames",
]


def calculate_cents_deviation(frequency_hz: float, scale_degree: str) -> float:
    """Deviation in cents of ``frequency_hz`` from a *specific* scale degree.

    Unlike :func:`hz_to_somali_note` (which snaps to the nearest degree), this
    measures against a caller-chosen reference. That distinction matters for
    the microtonality analysis: when aggregating "how is *mi* actually sung",
    every frame must be measured against *mi*'s reference — even frames far
    enough off that nearest-note snapping would have relabelled them.

    Args:
        frequency_hz: Detected fundamental frequency. Must be positive.
        scale_degree: One of the keys of ``SOMALI_SCALE_HZ`` (e.g. ``"mi"``).

    Returns:
        Signed deviation in cents (+50.0 = quarter tone sharp), rounded to
        2 decimal places to match ``hz_to_somali_note``.

    Raises:
        ValueError: If ``frequency_hz`` is not positive.
        KeyError: If ``scale_degree`` is not a Somali scale degree.
    """
    if frequency_hz <= 0:
        raise ValueError("frequency must be positive")
    reference_hz = SOMALI_SCALE_HZ[scale_degree]
    return round(1200.0 * math.log2(frequency_hz / reference_hz), 2)
