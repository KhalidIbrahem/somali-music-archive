"""F0 contour → note events (the heart of the dedicated vocal transcriber).

basic-pitch is a general polyphonic detector; a SUNG line deserves better. A
monophonic f0 tracker (CREPE) gives a 100-frames-per-second pitch ribbon with
per-frame confidence — this module segments that ribbon into notes the way a
listener does:

  1. keep only confidently-voiced frames (breaths and consonants break runs),
  2. median-smooth to kill octave glitches,
  3. within a voiced run, cut a new note when pitch settles ≥ `split_cents`
     away from the current note's running median for ≥ `settle_frames`.
     `settle_frames` must exceed a vibrato HALF-PERIOD (5-7 Hz singing vibrato
     → ~70-100 ms): an excursion that returns within that window is vibrato or
     an ornament and is absorbed; a real note change stays away. The split is
     retro-dated to the first away-frame, so onsets stay accurate even with
     the long window,
  4. score each note with its median pitch (in cents — microtones preserved
     for the pentatonic stage) and mean confidence.

Pure numpy — runs and is unit-testable under any Python. The torch/CREPE I/O
wrapper lives in scripts/vocal_f0.py.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

A4_HZ = 440.0
A4_MIDI = 69


def hz_to_cents(f0_hz: np.ndarray) -> np.ndarray:
    """Hz → absolute cents on the MIDI scale (midi*100). Unvoiced-safe: <=0 → nan."""
    f0 = np.asarray(f0_hz, dtype=float)
    out = np.full(f0.shape, np.nan)
    pos = f0 > 0
    out[pos] = (A4_MIDI + 12.0 * np.log2(f0[pos] / A4_HZ)) * 100.0
    return out


def median_smooth(x: np.ndarray, width: int = 5) -> np.ndarray:
    """Odd-width running median that ignores NaNs (keeps them in place)."""
    x = np.asarray(x, dtype=float)
    if width < 3 or len(x) == 0:
        return x.copy()
    half = width // 2
    out = x.copy()
    for i in range(len(x)):
        window = x[max(0, i - half): i + half + 1]
        finite = window[np.isfinite(window)]
        if len(finite) and np.isfinite(x[i]):
            out[i] = float(np.median(finite))
    return out


@dataclass
class F0Note:
    start: float
    end: float
    cents: float  # median pitch, microtones intact
    confidence: float
    amp: float

    @property
    def midi(self) -> int:
        return int(round(self.cents / 100.0))


def segment_notes(
    times: np.ndarray,
    cents: np.ndarray,
    confidence: np.ndarray,
    amplitude: np.ndarray | None = None,
    *,
    voicing_threshold: float = 0.5,
    split_cents: float = 80.0,
    settle_frames: int = 12,
    min_note_sec: float = 0.08,
    max_gap_sec: float = 0.06,
) -> list[F0Note]:
    """Segment a smoothed f0 ribbon into note events (see module docstring)."""
    times = np.asarray(times, dtype=float)
    cents = np.asarray(cents, dtype=float)
    confidence = np.asarray(confidence, dtype=float)
    amp = np.asarray(amplitude, dtype=float) if amplitude is not None else np.ones_like(times)

    voiced = np.isfinite(cents) & (confidence >= voicing_threshold)
    notes: list[F0Note] = []

    def flush(idx: list[int]) -> None:
        if not idx:
            return
        start, end = times[idx[0]], times[idx[-1]]
        # extend the last frame by one median hop so notes have real width
        if len(times) > 1:
            end += float(np.median(np.diff(times)))
        if end - start < min_note_sec:
            return
        seg_cents = cents[idx]
        notes.append(F0Note(
            start=float(start),
            end=float(end),
            cents=float(np.median(seg_cents)),
            confidence=float(np.mean(confidence[idx])),
            amp=float(np.clip(np.mean(amp[idx]), 0.0, 1.0)),
        ))

    current: list[int] = []  # frames of the note being built
    pending: list[int] = []  # frames that moved away but haven't settled yet
    for i in range(len(times)):
        if not voiced[i]:
            last = (pending or current)[-1] if (pending or current) else None
            # allow micro-gaps (consonants) inside one note
            if last is not None and times[i] - times[last] <= max_gap_sec:
                continue
            flush(current + pending)  # unresolved excursion stays with its note
            current, pending = [], []
            continue
        if not current:
            current = [i]
            continue
        ref = float(np.median(cents[current]))
        if abs(cents[i] - ref) >= split_cents:
            pending.append(i)
            if len(pending) >= settle_frames:
                # settled at a new pitch: the excursion frames ARE the new note
                flush(current)
                current, pending = pending, []
        else:
            if pending:
                # excursion returned — vibrato/ornament, absorb and move on
                current.extend(pending)
                pending = []
            current.append(i)
    flush(current + pending)
    return notes
