import { describe, expect, it } from 'vitest';
import { splitIntoPhrases } from '../phrases';
import type { RefNote } from '../practiceScore';

const note = (startBeat: number, midi = 60, lengthBeats = 1): RefNote => ({
  startBeat,
  lengthBeats,
  midi,
});

/** Quarter notes on every beat from `from` for `count` beats, walking a pentatonic shape. */
const quarters = (from: number, count: number): RefNote[] =>
  Array.from({ length: count }, (_, i) => note(from + i, [60, 62, 64, 67, 69][i % 5] ?? 60));

describe('splitIntoPhrases — bar groups', () => {
  it('splits a 4-bar melody in 4/4 into two 2-bar phrases', () => {
    const phrases = splitIntoPhrases(quarters(0, 16), 4);
    expect(phrases).toHaveLength(2);
    expect(phrases.map((p) => [p.startBeat, p.endBeat])).toEqual([
      [0, 8],
      [8, 16],
    ]);
    expect(phrases.map((p) => p.label)).toEqual(['Phrase 1', 'Phrase 2']);
    expect(phrases.map((p) => p.index)).toEqual([0, 1]);
    expect(phrases[0]?.notes.map((n) => n.startBeat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(phrases[1]?.notes).toHaveLength(8);
  });

  it('honours barsPerPhrase', () => {
    expect(splitIntoPhrases(quarters(0, 16), 4, { barsPerPhrase: 1 })).toHaveLength(4);
    const whole = splitIntoPhrases(quarters(0, 16), 4, { barsPerPhrase: 4 });
    expect(whole).toHaveLength(1);
    expect(whole[0]?.endBeat).toBe(16);
  });

  it('works in 3/4', () => {
    const phrases = splitIntoPhrases(quarters(0, 12), 3);
    expect(phrases.map((p) => [p.startBeat, p.endBeat])).toEqual([
      [0, 6],
      [6, 12],
    ]);
  });

  it('drops empty phrases and renumbers from the first note', () => {
    const phrases = splitIntoPhrases(quarters(16, 8), 4);
    expect(phrases).toHaveLength(1);
    expect(phrases[0]).toMatchObject({ index: 0, startBeat: 16, endBeat: 24, label: 'Phrase 1' });
  });

  it('keeps a note that crosses a boundary with the phrase holding its start', () => {
    // No rest anywhere: the note on beat 7 sounds to 9, the next starts at 9.
    const phrases = splitIntoPhrases([...quarters(0, 7), note(7, 64, 2), note(9)], 4);
    expect(phrases[0]?.notes.map((n) => n.startBeat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(phrases[1]?.notes.map((n) => n.startBeat)).toEqual([9]);
  });

  it('sorts unsorted input and returns [] for no notes', () => {
    const phrases = splitIntoPhrases([note(9), note(1), note(0)], 4);
    expect(phrases.map((p) => p.notes.map((n) => n.startBeat))).toEqual([[0, 1], [9]]);
    expect(splitIntoPhrases([], 4)).toEqual([]);
  });
});

describe('splitIntoPhrases — rests', () => {
  it('closes a phrase at the bar line after a long rest', () => {
    // Notes end at beat 3; the next starts at 5 (a 2-beat rest) → cut at bar line 4.
    const phrases = splitIntoPhrases([...quarters(0, 3), ...quarters(5, 3)], 4);
    expect(phrases.map((p) => [p.startBeat, p.endBeat])).toEqual([
      [0, 4],
      [4, 8],
    ]);
    expect(phrases[0]?.notes).toHaveLength(3);
    expect(phrases[1]?.notes.map((n) => n.startBeat)).toEqual([5, 6, 7]);
  });

  it('ignores a rest shorter than restGapBeats', () => {
    const phrases = splitIntoPhrases([...quarters(0, 3), ...quarters(4, 4)], 4);
    expect(phrases).toHaveLength(1);
    const custom = splitIntoPhrases([...quarters(0, 3), ...quarters(4, 4)], 4, {
      restGapBeats: 1,
    });
    expect(custom).toHaveLength(2);
  });

  it('cuts on a rest that starts exactly on a bar line', () => {
    const phrases = splitIntoPhrases([...quarters(0, 4), ...quarters(6, 2)], 4);
    expect(phrases.map((p) => [p.startBeat, p.endBeat])).toEqual([
      [0, 4],
      [4, 8],
    ]);
  });

  it('adds nothing when the rest snaps onto the group boundary', () => {
    // Notes at 4 and 5 end at 6; the next starts at 9: the bar line after 6 is 8, the group end.
    const phrases = splitIntoPhrases([note(4), note(5), note(9)], 4);
    expect(phrases.map((p) => [p.startBeat, p.endBeat])).toEqual([
      [0, 8],
      [8, 16],
    ]);
  });

  it('lets a held note mask a gap between shorter notes', () => {
    // The low note sounds until beat 4, so the silence before 4.5 is only half a beat.
    const phrases = splitIntoPhrases([note(0, 48, 4), note(1, 64, 0.5), note(4.5, 62)], 4);
    expect(phrases).toHaveLength(1);
  });

  it('is immune to float noise at a bar line', () => {
    const phrases = splitIntoPhrases([note(7.7, 60, 0.3), note(10)], 4);
    expect(phrases.map((p) => [p.startBeat, p.endBeat])).toEqual([
      [0, 8],
      [8, 16],
    ]);
  });
});
