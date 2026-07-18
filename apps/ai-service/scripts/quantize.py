"""Track B research stage: pentatonic-aware pitch quantization of note events.

Pure numpy — no basic-pitch/torch imports — so it runs and is unit-testable
under any Python. This is the stage 12-TET-centric tools (klang.io-style)
cannot do: it detects the tonic and 5-degree set from the audio's own notes,
snaps only notes within a cents tolerance, and leaves outliers unsnapped but
MARKED, because ornaments and microtonal inflections are musical information,
not error. Every note gets a confidence.

The Western-key-correction baseline (Krumhansl–Schmuckler major/minor profiles,
snap everything to the winning diatonic set) is implemented here too, as
ablation condition (ii).
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np

from scripts.pentatonic import PC_NAMES, detect_tonic, tuning_offset

TOL_CENTS_DEFAULT = 50.0

# Krumhansl-Kessler key profiles
_KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
_MAJOR_DEGREES = (0, 2, 4, 5, 7, 9, 11)
_MINOR_DEGREES = (0, 2, 3, 5, 7, 8, 10)


@dataclass
class Note:
    start: float
    end: float
    midi: int
    amp: float
    cents: float  # absolute cents = 100*midi + sub-semitone deviation

    @property
    def dur(self) -> float:
        return self.end - self.start


@dataclass
class QNote(Note):
    snapped: bool = False
    marked: bool = False  # outlier left unsnapped — ornament/microtonal information
    confidence: float = 1.0
    cents_dist: float = 0.0  # distance to nearest scale degree (pre-snap)


def _circ_dist_cents(cents: np.ndarray, degree_cents: np.ndarray) -> np.ndarray:
    """Min circular distance (cents) of each pitch to any degree, mod 1200."""
    folded = np.asarray(cents) % 1200.0
    d = np.abs(((folded[:, None] - degree_cents[None, :]) + 600.0) % 1200.0 - 600.0)
    return d.min(axis=1)


def detect_scale(notes: list[Note]) -> dict:
    """Tuning offset + tonic/mode/degrees from the notes themselves."""
    if not notes:
        raise ValueError("no notes")
    cents = np.array([n.cents for n in notes])
    durs = np.array([n.dur for n in notes])
    off = tuning_offset(cents, weights=durs)
    pc = np.round((cents - off) / 100.0).astype(int) % 12
    hist = np.zeros(12)
    np.add.at(hist, pc, durs)
    det = detect_tonic(hist)
    det["tuning_offset_cents"] = off
    return det


def pcs_of_notes(notes: list[Note], det: dict, tol: float = TOL_CENTS_DEFAULT) -> float:
    """Duration-weighted fraction of note time within tol cents of a scale degree.

    Always evaluated against the RAW-audio-detected scale in `det`, so ablation
    conditions are scored on the same reference.
    """
    cents = np.array([n.cents for n in notes]) - det["tuning_offset_cents"]
    durs = np.array([n.dur for n in notes])
    dist = _circ_dist_cents(cents, np.array(det["degrees"]) * 100.0)
    return float((durs * (dist <= tol)).sum() / durs.sum())


def pentatonic_quantize(notes: list[Note], det: dict,
                        tol: float = TOL_CENTS_DEFAULT) -> list[QNote]:
    """Condition (iii): snap within-tolerance notes to the detected pentatonic
    degree; leave outliers unsnapped and marked. confidence = 1 - dist/100c."""
    degree_cents = np.array(det["degrees"]) * 100.0
    off = det["tuning_offset_cents"]
    out: list[QNote] = []
    for n in notes:
        rel = n.cents - off
        d = float(_circ_dist_cents(np.array([rel]), degree_cents)[0])
        conf = float(np.clip(1.0 - d / 100.0, 0.0, 1.0))
        q = QNote(**n.__dict__, cents_dist=d, confidence=conf)
        if d <= tol:
            folded = rel % 1200.0
            deg = degree_cents[np.argmin(np.abs(
                ((folded - degree_cents) + 600.0) % 1200.0 - 600.0))]
            snapped_cents = rel - ((folded - deg + 600.0) % 1200.0 - 600.0)
            q.cents = snapped_cents + off
            q.midi = int(round(snapped_cents / 100.0))
            q.snapped = True
        else:
            q.marked = True  # keep original pitch — ornament/inflection preserved
        out.append(q)
    return out


def western_correct(notes: list[Note]) -> tuple[list[Note], str]:
    """Condition (ii): Krumhansl–Schmuckler key estimate, then snap EVERY note
    to the nearest diatonic degree of that key (no outlier protection) — what a
    12-TET Western tool does to a pentatonic melody."""
    durs = np.array([n.dur for n in notes])
    pc = np.array([int(round(n.cents / 100.0)) % 12 for n in notes])
    hist = np.zeros(12)
    np.add.at(hist, pc, durs)
    best, best_r = None, -np.inf
    for tonic in range(12):
        rolled = np.roll(hist, -tonic)
        for name, prof, degs in (("major", _KK_MAJOR, _MAJOR_DEGREES),
                                 ("minor", _KK_MINOR, _MINOR_DEGREES)):
            r = np.corrcoef(rolled, prof)[0, 1]
            if r > best_r:
                best_r, best = r, (tonic, name, degs)
    tonic, name, degs = best
    degree_cents = np.array(sorted((tonic + d) % 12 for d in degs)) * 100.0
    out = []
    for n in notes:
        folded = n.cents % 1200.0
        deg = degree_cents[np.argmin(np.abs(
            ((folded - degree_cents) + 600.0) % 1200.0 - 600.0))]
        snapped = n.cents - ((folded - deg + 600.0) % 1200.0 - 600.0)
        out.append(replace(n, cents=snapped, midi=int(round(snapped / 100.0))))
    return out, f"{PC_NAMES[tonic]} {name}"
