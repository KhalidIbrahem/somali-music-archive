import { activeNoteAt, absoluteNoteY, followOffset, type ReaderNote } from './readerMath';

const notes: ReaderNote[] = [
  { start: 1.0, end: 1.5, page: 0, y: 100, confidence: 0.95 },
  { start: 1.5, end: 2.0, page: 0, y: 100, confidence: 0.8 },
  { start: 3.0, end: 3.4, page: 1, y: 40, confidence: 0.5 },
];

describe('activeNoteAt', () => {
  it('finds the sounding note and returns null in gaps', () => {
    expect(activeNoteAt(notes, 0.5)).toBeNull(); // before the first onset
    expect(activeNoteAt(notes, 1.0)).toBe(0); // onset is inclusive
    expect(activeNoteAt(notes, 1.49)).toBe(0);
    expect(activeNoteAt(notes, 1.5)).toBe(1); // boundary belongs to the next note
    expect(activeNoteAt(notes, 2.5)).toBeNull(); // gap between notes
    expect(activeNoteAt(notes, 3.2)).toBe(2);
    expect(activeNoteAt(notes, 3.4)).toBeNull(); // offset is exclusive
  });
});

describe('page geometry', () => {
  it('stacks pages with the gap and scales with zoom', () => {
    const note = notes[2];
    if (note === undefined) throw new Error('fixture');
    // page 1 starts at (1056 + 12); note sits 40px into it — then ×zoom.
    expect(absoluteNoteY(note, 1056, 12, 1)).toBe(1068 + 40);
    expect(absoluteNoteY(note, 1056, 12, 2)).toBe((1068 + 40) * 2);
  });

  it('follow offset targets 35% down the viewport and clamps at the top', () => {
    const first = notes[0];
    const later = notes[2];
    if (first === undefined || later === undefined) throw new Error('fixture');
    expect(followOffset(first, 1056, 12, 1, 800)).toBe(0); // 100 - 280 → clamped
    expect(followOffset(later, 1056, 12, 1, 800)).toBe(1108 - 280);
  });
});
