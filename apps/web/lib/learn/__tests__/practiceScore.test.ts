import { describe, expect, it } from 'vitest';
import {
  estimateOffset,
  samePitch,
  scorePractice,
  type PlayedNote,
  type RefNote,
} from '../practiceScore';

const ref = (startBeat: number, midi: number, lengthBeats = 1): RefNote => ({
  startBeat,
  lengthBeats,
  midi,
});
const play = (startBeat: number, midi: number, lengthBeats = 1): PlayedNote => ({
  startBeat,
  endBeat: startBeat + lengthBeats,
  midi,
  velocity: 0.8,
});

/** A four-note opening, one note per beat: C D E C. */
const PHRASE: RefNote[] = [ref(0, 60), ref(1, 62), ref(2, 64), ref(3, 60)];
const perfectTake = (): PlayedNote[] => PHRASE.map((note) => play(note.startBeat, note.midi));

describe('scorePractice — matching', () => {
  it('scores a perfect performance 100 and excellent', () => {
    const score = scorePractice(PHRASE, perfectTake());
    expect(score.overall).toBe(100);
    expect(score.verdict).toBe('excellent');
    expect(score.pitchAccuracy).toBe(1);
    expect(score.timingAccuracy).toBe(1);
    expect(score.completeness).toBe(1);
    expect(score.meanOffsetBeats).toBe(0);
    expect(score.extras).toEqual([]);
    expect(score.matches).toHaveLength(4);
    expect(score.matches.every((m) => m.pitchOk && m.deltaBeats === 0)).toBe(true);
  });

  it('keeps one match per reference note, in the order the reference was given', () => {
    const shuffled = [PHRASE[2], PHRASE[0], PHRASE[3], PHRASE[1]].filter(
      (note): note is RefNote => note !== undefined,
    );
    const score = scorePractice(shuffled, perfectTake());
    expect(score.matches.map((m) => m.ref.startBeat)).toEqual([2, 0, 3, 1]);
    expect(score.overall).toBe(100);
  });

  it('lets each played note match at most once', () => {
    const score = scorePractice([ref(0, 60), ref(0.25, 60)], [play(0.1, 60)]);
    const matched = score.matches.filter((m) => m.played !== null);
    expect(matched).toHaveLength(1);
    expect(matched[0]?.ref.startBeat).toBe(0);
    expect(score.matches[1]?.played).toBeNull();
    expect(score.completeness).toBe(0.5);
  });

  it('prefers the right pitch over a closer wrong note within tolerance', () => {
    const score = scorePractice([ref(0, 60)], [play(0.05, 62), play(0.3, 60)]);
    expect(score.matches[0]?.played?.midi).toBe(60);
    expect(score.matches[0]?.deltaBeats).toBeCloseTo(0.3);
    expect(score.matches[0]?.pitchOk).toBe(true);
    expect(score.extras.map((n) => n.midi)).toEqual([62]);
  });

  it('misses a note played outside the tolerance and lists it as an extra', () => {
    const score = scorePractice([ref(0, 60)], [play(0.6, 60)]);
    expect(score.matches[0]?.played).toBeNull();
    expect(score.matches[0]?.deltaBeats).toBeNull();
    expect(score.matches[0]?.pitchOk).toBe(false);
    expect(score.extras).toHaveLength(1);
    expect(score.completeness).toBe(0);
  });
});

describe('scorePractice — pitch and timing', () => {
  it('counts the wrong octave as the right note only when octave tolerant', () => {
    const upAnOctave = PHRASE.map((note) => play(note.startBeat, note.midi + 12));
    const tolerant = scorePractice(PHRASE, upAnOctave);
    expect(tolerant.matches.every((m) => m.pitchOk)).toBe(true);
    expect(tolerant.overall).toBe(100);

    const strict = scorePractice(PHRASE, upAnOctave, { octaveTolerant: false });
    expect(strict.matches.every((m) => m.played !== null && !m.pitchOk)).toBe(true);
    expect(strict.pitchAccuracy).toBe(0);
    expect(strict.timingAccuracy).toBe(1);
    expect(strict.completeness).toBe(1);
    expect(strict.overall).toBe(50);
    expect(strict.verdict).toBe('keep-practising');
  });

  it('lowers pitch accuracy for a wrong note at the right time but keeps its timing', () => {
    const take = [play(0, 60), play(1, 62), play(2, 63), play(3, 60)];
    const score = scorePractice(PHRASE, take);
    expect(score.matches[2]?.pitchOk).toBe(false);
    expect(score.matches[2]?.deltaBeats).toBe(0);
    expect(score.pitchAccuracy).toBe(0.75);
    expect(score.timingAccuracy).toBe(1);
    expect(score.completeness).toBe(1);
    expect(score.overall).toBe(88); // 37.5 + 30 + 20
    expect(score.extras).toEqual([]);
  });

  it('gives partial timing credit inside the tolerance and reports the signed offset', () => {
    const take = [play(0, 60), play(1, 62), play(2.25, 64), play(3, 60)];
    const score = scorePractice(PHRASE, take);
    expect(score.matches[2]?.deltaBeats).toBeCloseTo(0.25);
    expect(score.timingAccuracy).toBeCloseTo(0.875); // (1 + 1 + 0.5 + 1) / 4
    expect(score.meanOffsetBeats).toBeCloseTo(0.0625);
    expect(score.overall).toBe(96); // 50 + 26.25 + 20
    expect(score.verdict).toBe('excellent');
  });

  it('takes two points off per extra note', () => {
    const take = [...perfectTake(), play(0.5, 67), play(2.5, 67)];
    const score = scorePractice(PHRASE, take);
    expect(score.extras.map((n) => n.startBeat)).toEqual([0.5, 2.5]);
    expect(score.overall).toBe(96);
    expect(score.pitchAccuracy).toBe(1);
  });

  it('scores an empty take as nothing played', () => {
    const score = scorePractice(PHRASE, []);
    expect(score.completeness).toBe(0);
    expect(score.pitchAccuracy).toBe(0);
    expect(score.timingAccuracy).toBe(0);
    expect(score.overall).toBe(0);
    expect(score.verdict).toBe('keep-practising');
    expect(score.matches.every((m) => m.played === null && m.deltaBeats === null)).toBe(true);
  });

  it('scores an empty reference 0 with every played note an extra', () => {
    const score = scorePractice([], perfectTake());
    expect(score.matches).toEqual([]);
    expect(score.extras).toHaveLength(4);
    expect(score.overall).toBe(0);
  });

  it('grades good between 60 and 85', () => {
    // Two notes right, two missed: 25 + 30 + 10 = 65.
    const score = scorePractice(PHRASE, [play(0, 60), play(1, 62)]);
    expect(score.overall).toBe(65);
    expect(score.verdict).toBe('good');
  });

  it('honours a custom tolerance', () => {
    const score = scorePractice([ref(0, 60)], [play(0.4, 60)], { toleranceBeats: 0.25 });
    expect(score.matches[0]?.played).toBeNull();
    const wide = scorePractice([ref(0, 60)], [play(0.4, 60)], { toleranceBeats: 1 });
    expect(wide.timingAccuracy).toBeCloseTo(0.6);
  });
});

describe('estimateOffset', () => {
  it('rescues a take that started one beat late', () => {
    const late = PHRASE.map((note) => play(note.startBeat + 1, note.midi));
    const unaligned = scorePractice(PHRASE, late);
    expect(unaligned.overall).toBeLessThan(60);

    const offset = estimateOffset(PHRASE, late);
    expect(offset).toBeCloseTo(1);
    const aligned = scorePractice(PHRASE, late, { offsetBeats: offset });
    expect(aligned.overall).toBe(100);
    expect(aligned.verdict).toBe('excellent');
    expect(aligned.meanOffsetBeats).toBeCloseTo(0);
  });

  it('survives a missed first note and an early start', () => {
    const missedFirst = [play(2, 62), play(3, 64), play(4, 60)];
    expect(estimateOffset(PHRASE, missedFirst)).toBeCloseTo(1);
    const early = PHRASE.map((note) => play(note.startBeat - 0.5, note.midi));
    expect(estimateOffset(PHRASE, early)).toBeCloseTo(-0.5);
  });

  it('matches by pitch class across octaves and returns 0 when nothing matches', () => {
    const octaveUp = PHRASE.map((note) => play(note.startBeat + 2, note.midi + 12));
    expect(estimateOffset(PHRASE, octaveUp)).toBeCloseTo(2);
    expect(estimateOffset(PHRASE, [play(0, 66), play(1, 66)])).toBe(0);
    expect(estimateOffset(PHRASE, [])).toBe(0);
    expect(estimateOffset([], perfectTake())).toBe(0);
  });

  it('prefers the smaller shift when the melody repeats a pitch class', () => {
    const repeated = [ref(0, 60), ref(1, 60), ref(2, 60), ref(3, 60)];
    const take = repeated.map((note) => play(note.startBeat, note.midi));
    expect(estimateOffset(repeated, take)).toBe(0);
  });
});

describe('samePitch', () => {
  it('compares exact MIDI or pitch class', () => {
    expect(samePitch(60, 60, false)).toBe(true);
    expect(samePitch(72, 60, false)).toBe(false);
    expect(samePitch(72, 60, true)).toBe(true);
    expect(samePitch(61, 60, true)).toBe(false);
  });
});
