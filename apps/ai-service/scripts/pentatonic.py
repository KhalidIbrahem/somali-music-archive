"""Tonic + pentatonic-scale detection for Somali (anhemitonic pentatonic) material.

Core idea: correlate a duration-weighted pitch-class histogram against the five
rotations (modes) of the anhemitonic pentatonic template at all 12 transpositions,
instead of Krumhansl 12-TET major/minor profiles. Shared by Phase 1 (captions),
Phase 3 (PCS metric) and Phase 4 (transcription quantizer).
"""

from __future__ import annotations

import numpy as np

PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Base anhemitonic pentatonic set and its 5 rotations (modes), as semitone
# offsets from the mode root.
_BASE = (0, 2, 4, 7, 9)
MODES: list[tuple[int, ...]] = [
    tuple(sorted((p - _BASE[r]) % 12 for p in _BASE)) for r in range(5)
]

# Template weight per scale degree: root strongest so that among the five
# enharmonically identical rotations the emphasized pitch wins the root.
_ROOT_W, _FIFTH_W, _DEGREE_W = 3.0, 1.5, 1.0


def mode_template(mode: tuple[int, ...]) -> np.ndarray:
    t = np.zeros(12)
    for deg in mode:
        t[deg] = _DEGREE_W
    t[0] = _ROOT_W
    if 7 in mode:
        t[7] = _FIFTH_W
    return t


_TEMPLATES = [mode_template(m) for m in MODES]


def detect_tonic(hist: np.ndarray) -> dict:
    """Best (tonic, mode) for a 12-bin pitch-class histogram.

    Returns dict with tonic_pc, tonic_name, mode (0..4), score (Pearson r),
    degrees (absolute pitch classes of the detected scale).
    """
    hist = np.asarray(hist, dtype=np.float64)
    if hist.sum() <= 0:
        raise ValueError("empty pitch-class histogram")
    hist = hist / hist.sum()
    best = {"score": -np.inf}
    for tonic in range(12):
        rolled = np.roll(hist, -tonic)  # tonic -> bin 0
        for mode_idx, tmpl in enumerate(_TEMPLATES):
            r = np.corrcoef(rolled, tmpl)[0, 1]
            if r > best["score"]:
                degrees = sorted((tonic + d) % 12 for d in MODES[mode_idx])
                best = {
                    "tonic_pc": tonic,
                    "tonic_name": PC_NAMES[tonic],
                    "mode": mode_idx,
                    "score": float(r),
                    "degrees": degrees,
                }
    return best


def hist_from_audio(y: np.ndarray, sr: int, hop_length: int = 4096) -> np.ndarray:
    """Energy-weighted pitch-class histogram from an audio signal (chroma STFT)."""
    import librosa

    chroma = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=hop_length)
    return chroma.sum(axis=1)


def detect_from_audio(y: np.ndarray, sr: int) -> dict:
    return detect_tonic(hist_from_audio(y, sr))


def tuning_offset(cents: np.ndarray, weights: np.ndarray | None = None) -> float:
    """Global deviation from 12-TET in cents, in [-50, 50), via circular mean."""
    frac = np.deg2rad((np.asarray(cents) % 100.0) * 3.6)  # 100 cents -> 360 deg
    w = np.ones_like(frac) if weights is None else np.asarray(weights, dtype=float)
    mean = np.arctan2((w * np.sin(frac)).sum() / w.sum(),
                      (w * np.cos(frac)).sum() / w.sum())
    return float(np.rad2deg(mean) / 3.6)


def hist_from_events(midi_pitches: np.ndarray, durations: np.ndarray) -> np.ndarray:
    """Duration-weighted pitch-class histogram from note events (Phase 4 path)."""
    hist = np.zeros(12)
    for p, d in zip(np.asarray(midi_pitches), np.asarray(durations)):
        hist[int(round(p)) % 12] += float(d)
    return hist


def detect_from_events(midi_pitches: np.ndarray, durations: np.ndarray) -> dict:
    return detect_tonic(hist_from_events(midi_pitches, durations))
