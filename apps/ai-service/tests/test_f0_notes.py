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


# ---------------------------------------------------------------- legato (plucked strings)
def _pluck(times, start, dur, cents, attack=0.9, floor=0.2, conf_high=0.9, conf_low=0.2, decay_at=0.4):
    """One plucked note: pitch steady, envelope decaying from `attack` to `floor`,
    CREPE confidence dropping under the threshold after `decay_at` of the note."""
    i0, i1 = int(start * 100), int((start + dur) * 100)
    idx = np.arange(i0, i1)
    frac = (idx - i0) / max(len(idx) - 1, 1)
    amp = attack * (1 - frac) + floor * frac
    conf = np.where(frac < decay_at, conf_high, conf_low)
    return idx, np.full(len(idx), cents, dtype=float), conf, amp


def _ribbon(seconds, plucks):
    n = int(seconds * 100)
    times = np.arange(n) / 100.0
    cents = np.full(n, np.nan); conf = np.zeros(n); amp = np.full(n, 0.02)
    for p in plucks:
        idx, c, k, a = p
        cents[idx], conf[idx], amp[idx] = c, k, a
    return times, cents, conf, amp


def test_legato_sustains_through_the_ring_out_and_ends_at_silence():
    from scripts.f0_notes import segment_notes

    times, cents, conf, amp = _ribbon(2.0, [_pluck(None, 0.2, 1.0, 6200)])
    plain = segment_notes(times, cents, conf, amp)
    legato = segment_notes(times, cents, conf, amp, legato=True)
    assert len(plain) == 1 and plain[0].end - plain[0].start < 0.5   # cut where confidence drops
    assert len(legato) == 1
    assert legato[0].start == plain[0].start
    assert legato[0].end >= 1.15  # carried through the decay to where the audio goes silent
    assert abs(legato[0].cents - 6200) < 1


def test_legato_still_ends_at_a_real_pitch_change():
    from scripts.f0_notes import segment_notes

    a = _pluck(None, 0.1, 0.6, 6200, decay_at=1.1)  # confident throughout
    b = _pluck(None, 0.7, 0.6, 6400, decay_at=1.1)
    times, cents, conf, amp = _ribbon(1.5, [a, b])
    notes = segment_notes(times, cents, conf, amp, legato=True)
    assert [round(n.cents) for n in notes] == [6200, 6400]
    assert abs(notes[0].end - 0.7) < 0.1 and abs(notes[1].start - 0.7) < 0.1


def test_legato_re_pluck_on_the_same_pitch_is_a_new_onset():
    from scripts.f0_notes import segment_notes

    a = _pluck(None, 0.1, 0.5, 6200, attack=0.9, floor=0.25, decay_at=1.1)
    b = _pluck(None, 0.6, 0.5, 6200, attack=0.9, floor=0.25, decay_at=1.1)
    times, cents, conf, amp = _ribbon(1.3, [a, b])
    notes = segment_notes(times, cents, conf, amp, legato=True)
    assert len(notes) == 2 and abs(notes[1].start - 0.6) < 0.05


def test_legato_does_not_sustain_when_the_envelope_has_died():
    from scripts.f0_notes import segment_notes

    times, cents, conf, amp = _ribbon(2.0, [_pluck(None, 0.2, 1.0, 6200, floor=0.0, decay_at=0.4)])
    notes = segment_notes(times, cents, conf, amp, legato=True)
    assert len(notes) == 1 and notes[0].end < 1.15  # the envelope reaches 15 percent before the end


def test_merge_notes_joins_same_pitch_across_short_gaps_only():
    from scripts.f0_notes import F0Note, merge_notes

    a = F0Note(0.0, 0.50, 6200.0, 0.9, 0.8)
    b = F0Note(0.60, 0.90, 6205.0, 0.7, 0.5)   # 100 ms gap, same pitch -> merged
    c = F0Note(1.10, 1.40, 6200.0, 0.9, 0.6)   # 200 ms gap -> kept apart
    d = F0Note(1.45, 1.70, 6400.0, 0.9, 0.6)   # short gap, different pitch -> kept apart
    out = merge_notes([a, b, c, d], max_gap_sec=0.12)
    assert [(n.start, n.end) for n in out] == [(0.0, 0.9), (1.1, 1.4), (1.45, 1.7)]
    assert 6200 < out[0].cents < 6205 and out[0].amp == 0.8


def test_merge_notes_keeps_abutting_re_plucks_apart():
    from scripts.f0_notes import F0Note, merge_notes

    # Two plucks of the same note, cut at the second attack: no gap between them.
    a = F0Note(0.0, 0.40, 6200.0, 0.9, 0.8)
    b = F0Note(0.40, 0.80, 6200.0, 0.9, 0.8)
    c = F0Note(0.85, 1.20, 6200.0, 0.9, 0.6)   # 50 ms gap -> a fragment, joined to b
    out = merge_notes([a, b, c], max_gap_sec=0.12)
    assert [(n.start, n.end) for n in out] == [(0.0, 0.4), (0.4, 1.2)]


def test_legato_note_confidence_is_judged_on_its_pitched_frames():
    # 20 confident frames, then a 40-frame ring-out the tracker is unsure of.
    from scripts.f0_notes import segment_notes

    n = 60
    times = np.arange(n) * 0.01
    cents = np.full(n, 6200.0)
    conf = np.where(np.arange(n) < 20, 0.9, 0.2)
    amp = np.where(np.arange(n) < 20, 0.8, 0.4)
    (note,) = segment_notes(times, cents, conf, amp, voicing_threshold=0.5, legato=True)
    assert note.end > 0.55          # the ring-out was sustained
    assert note.confidence > 0.85   # and did not vote on the confidence
