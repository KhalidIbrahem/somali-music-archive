"""Beat-tracked rhythm grid (Track B accuracy stage).

A single global BPM renders Somali performance timing wrong by construction:
qaraami and heello breathe (rubato), so a fixed 16th grid drifts further from
the singer the longer the take runs — transcriptions sound "close in places",
exactly where the performer happened to meet the grid. Mapping each note onto
the PIECEWISE-LINEAR beat axis from an actual beat tracker keeps every note
aligned to its LOCAL beat instead.

Pure numpy — librosa supplies `beat_times` elsewhere (transcribe.py), so this
module runs and is unit-testable under any Python, like scripts/quantize.py.
"""

from __future__ import annotations

import numpy as np

# Below this many tracked beats the map is too unreliable — callers fall back
# to the fixed-BPM grid.
MIN_BEATS_FOR_GRID = 4


def times_to_beats(t: np.ndarray | list[float], beat_times: np.ndarray | list[float]) -> np.ndarray:
    """Map seconds -> fractional beat positions (beat 0 at beat_times[0]).

    Piecewise-linear between tracked beats; outside the tracked range the edge
    intervals extrapolate, so a pickup note before the first beat or a tail
    after the last one still lands proportionally instead of clamping.
    """
    bt = np.asarray(beat_times, dtype=float)
    if bt.ndim != 1 or len(bt) < 2:
        raise ValueError("times_to_beats needs at least two beat times")
    t = np.atleast_1d(np.asarray(t, dtype=float))
    idx = np.arange(len(bt), dtype=float)
    out = np.interp(t, bt, idx)
    first, last = bt[1] - bt[0], bt[-1] - bt[-2]
    before, after = t < bt[0], t > bt[-1]
    out[before] = (t[before] - bt[0]) / first
    out[after] = (len(bt) - 1) + (t[after] - bt[-1]) / last
    return out


def snap_notes_to_beats(
    starts: np.ndarray | list[float],
    ends: np.ndarray | list[float],
    beat_times: np.ndarray | list[float],
    sub: int = 4,
) -> tuple[np.ndarray, np.ndarray]:
    """Quantize note times to a 1/`sub`-beat grid on the beat axis.

    Returns (offsets_ql, durations_ql) where one quarterLength == one beat —
    directly insertable into a music21 stream whose MetronomeMark carries the
    median tempo. Durations floor at one subdivision so no note vanishes.
    """
    sb = times_to_beats(starts, beat_times)
    eb = times_to_beats(ends, beat_times)
    step = 1.0 / sub
    offsets = np.maximum(0.0, np.round(sb / step) * step)
    durations = np.maximum(step, np.round((eb - sb) / step) * step)
    return offsets, durations


def median_bpm(beat_times: np.ndarray | list[float]) -> float:
    """Nominal tempo for the score's MetronomeMark: median inter-beat interval."""
    d = np.diff(np.asarray(beat_times, dtype=float))
    d = d[d > 1e-6]
    return float(60.0 / np.median(d)) if len(d) else 100.0
