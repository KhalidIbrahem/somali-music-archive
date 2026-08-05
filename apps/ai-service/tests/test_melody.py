"""Melody skyline reduction (scripts/melody.py)."""

from __future__ import annotations

from scripts.melody import melody_skyline
from scripts.quantize import Note


def note(start: float, end: float, midi: int = 60, amp: float = 0.5) -> Note:
    return Note(start=start, end=end, midi=midi, amp=amp, cents=100.0 * midi)


def test_non_overlapping_notes_pass_through() -> None:
    notes = [note(0.0, 0.5), note(0.5, 1.0, midi=62), note(1.2, 1.6, midi=64)]
    assert melody_skyline(notes) == notes


def test_quiet_overlap_is_dropped_as_accompaniment() -> None:
    melody = note(0.0, 1.0, midi=67, amp=0.8)
    oud_under = note(0.2, 0.6, midi=48, amp=0.3)
    assert melody_skyline([melody, oud_under]) == [melody]


def test_decisively_louder_newcomer_takes_over_and_truncates() -> None:
    first = note(0.0, 1.0, midi=60, amp=0.4)
    stronger = note(0.5, 1.2, midi=65, amp=0.9)
    out = melody_skyline([first, stronger])
    assert len(out) == 2
    assert out[0].end == 0.5  # truncated at the handover
    assert out[1] is stronger


def test_marginally_louder_newcomer_does_not_steal() -> None:
    first = note(0.0, 1.0, midi=60, amp=0.5)
    slightly = note(0.4, 0.9, midi=64, amp=0.55)  # < 1.2x
    assert melody_skyline([first, slightly]) == [first]


def test_takeover_leaving_a_sliver_removes_it() -> None:
    first = note(0.0, 1.0, midi=60, amp=0.4)
    immediate = note(0.02, 1.1, midi=65, amp=0.9)
    out = melody_skyline([first, immediate])
    assert out == [immediate]  # 20ms remnant discarded


def test_result_is_strictly_monophonic() -> None:
    notes = [note(i * 0.1, i * 0.1 + 0.35, midi=60 + i, amp=0.3 + 0.05 * i) for i in range(10)]
    out = melody_skyline(notes)
    for a, b in zip(out, out[1:]):
        assert b.start >= a.end


def test_empty_input() -> None:
    assert melody_skyline([]) == []
