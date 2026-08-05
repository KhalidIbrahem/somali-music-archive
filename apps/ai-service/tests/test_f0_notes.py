"""F0 → note segmentation (scripts/f0_notes.py) — synthetic-contour tests."""

from __future__ import annotations

import numpy as np

from scripts.f0_notes import hz_to_cents, median_smooth, segment_notes

HOP = 0.01  # 100 fps, like CREPE at 10ms


def ribbon(cents_seq: list[float], conf: float = 0.9):
    t = np.arange(len(cents_seq)) * HOP
    c = np.array(cents_seq, dtype=float)
    p = np.full(len(cents_seq), conf)
    return t, c, p


def test_hz_to_cents_a4_and_octaves() -> None:
    out = hz_to_cents(np.array([440.0, 220.0, 880.0, 0.0]))
    assert np.isclose(out[0], 6900.0)
    assert np.isclose(out[1], 5700.0)
    assert np.isclose(out[2], 8100.0)
    assert np.isnan(out[3])


def test_median_smooth_kills_octave_glitch() -> None:
    x = np.array([6900.0] * 5 + [8100.0] + [6900.0] * 5)  # one-frame octave spike
    sm = median_smooth(x, width=5)
    assert np.allclose(sm, 6900.0)


def test_steady_pitch_is_one_note() -> None:
    t, c, p = ribbon([6900.0] * 30)
    notes = segment_notes(t, c, p)
    assert len(notes) == 1
    assert notes[0].midi == 69
    assert notes[0].start == 0.0


def test_clean_step_splits_into_two_notes() -> None:
    t, c, p = ribbon([6900.0] * 20 + [7200.0] * 20)
    notes = segment_notes(t, c, p)
    assert [n.midi for n in notes] == [69, 72]
    # the new note starts where the pitch moved, not `settle_frames` late
    assert np.isclose(notes[1].start, 20 * HOP)


def test_vibrato_stays_one_note() -> None:
    base = 6900.0
    wobble = [base + 60.0 * np.sin(2 * np.pi * 5.5 * i * HOP) for i in range(60)]
    t, c, p = ribbon(wobble)
    notes = segment_notes(t, c, p, split_cents=80.0)
    assert len(notes) == 1
    assert notes[0].midi == 69


def test_ornament_flick_does_not_split() -> None:
    t, c, p = ribbon([6900.0] * 15 + [7100.0] * 8 + [6900.0] * 15)
    notes = segment_notes(t, c, p)  # 80ms excursion < settle window → one note
    assert len(notes) == 1


def test_unvoiced_gap_breaks_notes_but_consonant_gap_does_not() -> None:
    # 150ms silence → two notes
    t, c, p = ribbon([6900.0] * 20 + [6900.0] * 15 + [7200.0] * 20)
    p[20:35] = 0.0
    t2 = t.copy()
    t2[35:] += 0.15
    notes = segment_notes(t2, c, p)
    assert len(notes) == 2
    # 40ms dip (a consonant) → still one note
    t, c, p = ribbon([6900.0] * 40)
    p[18:22] = 0.0
    notes = segment_notes(t, c, p)
    assert len(notes) == 1


def test_short_blips_are_discarded() -> None:
    t, c, p = ribbon([6900.0] * 4)  # 40ms — under min_note_sec
    assert segment_notes(t, c, p) == []


def test_microtones_survive_in_cents() -> None:
    t, c, p = ribbon([6935.0] * 30)  # a quarter-tone above A4
    notes = segment_notes(t, c, p)
    assert np.isclose(notes[0].cents, 6935.0)
    assert notes[0].midi == 69  # rounded for display; cents keep the truth
