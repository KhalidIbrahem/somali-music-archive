"""Melody skyline reduction — from polyphonic note soup to ONE singable line.

basic-pitch reports every concurrent pitch it hears; rendered raw, a song
becomes hundreds of stacked note clusters — technically faithful, musically
unreadable ("a wall of black notes", not sheet music). For the notation
surface we reduce to a monophonic line the way an ear does: at any moment
keep the most salient note, let a clearly stronger newcomer take over (the
old note is truncated at the handover), and drop the residual slivers.

Pure numpy-free logic over quantize.Note — unit-testable under any Python.
The research CLI keeps raw polyphony by default; the notation service opts in.
"""

from __future__ import annotations

from dataclasses import replace

from scripts.quantize import Note

# A newcomer must be this much louder to steal the line mid-note; at 1.0 any
# louder note wins immediately, higher values favour the already-sounding note.
TAKEOVER_RATIO = 1.2
# Truncation leftovers shorter than this are noise, not melody.
MIN_NOTE_SEC = 0.05


def melody_skyline(notes: list[Note],
                   takeover_ratio: float = TAKEOVER_RATIO,
                   min_note_sec: float = MIN_NOTE_SEC) -> list[Note]:
    """Reduce overlapping note events to a strictly monophonic melody line."""
    if not notes:
        return []
    ordered = sorted(notes, key=lambda n: (n.start, -n.amp))
    line: list[Note] = []
    for cand in ordered:
        if not line:
            line.append(cand)
            continue
        cur = line[-1]
        if cand.start >= cur.end:  # no overlap — melody moves on
            line.append(cand)
            continue
        # Overlap: the sounding note keeps the line unless the newcomer is
        # decisively louder, in which case it takes over at its onset.
        if cand.amp > cur.amp * takeover_ratio:
            truncated = replace(cur, end=cand.start)
            if truncated.end - truncated.start >= min_note_sec:
                line[-1] = truncated
            else:
                line.pop()
            line.append(cand)
        # else: accompaniment under the melody — dropped.
    return [n for n in line if n.end - n.start >= min_note_sec]
