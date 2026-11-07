/**
 * Practice scoring for the Learn panel (Studio v3) — "how did I play?" for a
 * melody phrase.
 *
 * The reference is a phrase in beats (`RefNote`: the DAW note shape without
 * id and velocity); the take is what the learner played on the on-screen
 * instrument, the computer keyboard or a MIDI device, also in beats
 * (`PlayedNote`). Pure functions over plain data — no React, DOM or audio.
 *
 * Matching — each reference note, in time order, takes at most one played
 * note and each played note matches at most once:
 *   1. among the unmatched played notes whose offset-corrected start
 *      (`startBeat − offsetBeats`) lies within `toleranceBeats` of the
 *      reference start and whose pitch is right (same MIDI number, or the
 *      same pitch class when `octaveTolerant`), the smallest |delta| wins;
 *   2. failing that, the closest-in-time unmatched played note within
 *      tolerance, marked `pitchOk: false` — a wrong note at the right time
 *      still counts for timing;
 *   3. failing that, the reference note is missed (`played: null`).
 * Ties on |delta| go to the earlier played note. Deterministic, O(n·m).
 *
 * Scores (0..1 unless stated; `delta` = corrected played start − ref start):
 *   pitchAccuracy   = matched notes with pitchOk / reference count
 *   timingAccuracy  = mean over matched notes of max(0, 1 − |delta| / toleranceBeats)
 *   completeness    = matched notes / reference count
 *   meanOffsetBeats = signed mean delta over matched notes (negative = early)
 *   overall (0..100, rounded)
 *                   = max(0, 50·pitchAccuracy + 30·timingAccuracy + 20·completeness
 *                            − 2 · extra notes)
 *   verdict         = 'excellent' at ≥ 85, 'good' at ≥ 60, else 'keep-practising'
 * An empty reference scores 0 on every axis (every played note is an extra);
 * an empty take scores 0 completeness and 0 overall.
 *
 * `estimateOffset` recovers the start delay of a take that began late (or
 * early): it pairs the first few reference notes with the first few played
 * notes by pitch class, keeps the largest cluster of agreeing deltas and
 * returns that cluster's median — the value to pass as `offsetBeats`.
 */

export interface RefNote {
  startBeat: number;
  lengthBeats: number;
  midi: number;
}

export interface PlayedNote {
  startBeat: number;
  endBeat: number;
  midi: number;
  /** 0–1. */
  velocity: number;
}

export interface NoteMatch {
  ref: RefNote;
  /** null = missed. */
  played: PlayedNote | null;
  /** Offset-corrected played start − ref start (negative = early); null when missed. */
  deltaBeats: number | null;
  /** Exact MIDI, or the same pitch class when octaveTolerant; false when missed. */
  pitchOk: boolean;
}

export type PracticeVerdict = 'excellent' | 'good' | 'keep-practising';

export interface PracticeScore {
  /** One per reference note, in the order the reference was given. */
  matches: NoteMatch[];
  /** Played notes that matched nothing, in time order. */
  extras: PlayedNote[];
  /** 0..1: matched notes with pitchOk / reference count. */
  pitchAccuracy: number;
  /** 0..1: mean over matched notes of max(0, 1 − |delta| / toleranceBeats). */
  timingAccuracy: number;
  /** 0..1: matched / reference count. */
  completeness: number;
  /** Signed mean delta over matched notes (0 when none). */
  meanOffsetBeats: number;
  /** 0..100, rounded — see the file comment for the formula. */
  overall: number;
  verdict: PracticeVerdict;
}

export interface PracticeOptions {
  /** How far a played note may sit from the reference start and still count; default 0.5 (an eighth at 4/4). */
  toleranceBeats?: number;
  /** Same pitch class in any octave counts as the right note; default true (oud and voice sit in different octaves). */
  octaveTolerant?: boolean;
  /** Subtracted from every played start — aligns a take that began later; default 0. */
  offsetBeats?: number;
}

export const DEFAULT_PRACTICE_OPTIONS: Readonly<Required<PracticeOptions>> = {
  toleranceBeats: 0.5,
  octaveTolerant: true,
  offsetBeats: 0,
};

/** `overall` thresholds for the verdict. */
export const VERDICT_THRESHOLDS = { excellent: 85, good: 60 } as const;

/** Points taken off `overall` for every played note that matched no reference note. */
export const EXTRA_NOTE_PENALTY = 2;

/** Floor for the tolerance in the maths, so a zero tolerance means "exact" instead of 0/0. */
const MIN_TOLERANCE_BEATS = 1e-6;

/** Reference notes and played notes considered when estimating a take's start offset. */
const OFFSET_REFERENCE_NOTES = 4;
const OFFSET_PLAYED_NOTES = 8;
/** Deltas within this many beats of one another vote for the same start offset. */
const OFFSET_CLUSTER_BEATS = 0.5;

/** The right note: equal MIDI, or the same pitch class when `octaveTolerant`. */
export function samePitch(playedMidi: number, refMidi: number, octaveTolerant: boolean): boolean {
  if (playedMidi === refMidi) return true;
  return octaveTolerant && pitchClass(playedMidi) === pitchClass(refMidi);
}

export function scorePractice(
  reference: readonly RefNote[],
  played: readonly PlayedNote[],
  options?: PracticeOptions,
): PracticeScore {
  const tolerance = Math.max(
    options?.toleranceBeats ?? DEFAULT_PRACTICE_OPTIONS.toleranceBeats,
    MIN_TOLERANCE_BEATS,
  );
  const octaveTolerant = options?.octaveTolerant ?? DEFAULT_PRACTICE_OPTIONS.octaveTolerant;
  const offset = options?.offsetBeats ?? DEFAULT_PRACTICE_OPTIONS.offsetBeats;

  const refOrder = timeOrder(reference);
  const playedOrder = timeOrder(played);
  const taken: boolean[] = new Array<boolean>(played.length).fill(false);
  const matchByRefIndex = new Map<number, NoteMatch>();

  for (const refIndex of refOrder) {
    const ref = reference[refIndex];
    if (ref === undefined) continue;
    let rightPitch: Candidate | null = null;
    let nearest: Candidate | null = null;
    for (const playedIndex of playedOrder) {
      if (taken[playedIndex] === true) continue;
      const note = played[playedIndex];
      if (note === undefined) continue;
      const delta = note.startBeat - offset - ref.startBeat;
      const distance = Math.abs(delta);
      if (!(distance <= tolerance)) continue;
      if (nearest === null || distance < Math.abs(nearest.delta)) {
        nearest = { index: playedIndex, note, delta };
      }
      if (
        samePitch(note.midi, ref.midi, octaveTolerant) &&
        (rightPitch === null || distance < Math.abs(rightPitch.delta))
      ) {
        rightPitch = { index: playedIndex, note, delta };
      }
    }
    const chosen = rightPitch ?? nearest;
    if (chosen === null) continue;
    taken[chosen.index] = true;
    matchByRefIndex.set(refIndex, {
      ref,
      played: chosen.note,
      deltaBeats: chosen.delta,
      pitchOk: rightPitch !== null,
    });
  }

  const matches: NoteMatch[] = reference.map(
    (ref, index) =>
      matchByRefIndex.get(index) ?? { ref, played: null, deltaBeats: null, pitchOk: false },
  );
  const extras: PlayedNote[] = [];
  for (const playedIndex of playedOrder) {
    const note = played[playedIndex];
    if (note !== undefined && taken[playedIndex] !== true) extras.push(note);
  }

  let matchedCount = 0;
  let pitchOkCount = 0;
  let timingSum = 0;
  let deltaSum = 0;
  for (const match of matches) {
    if (match.deltaBeats === null) continue;
    matchedCount += 1;
    if (match.pitchOk) pitchOkCount += 1;
    timingSum += Math.max(0, 1 - Math.abs(match.deltaBeats) / tolerance);
    deltaSum += match.deltaBeats;
  }

  const refCount = reference.length;
  const pitchAccuracy = refCount > 0 ? pitchOkCount / refCount : 0;
  const timingAccuracy = matchedCount > 0 ? timingSum / matchedCount : 0;
  const completeness = refCount > 0 ? matchedCount / refCount : 0;
  const meanOffsetBeats = matchedCount > 0 ? deltaSum / matchedCount : 0;
  const overall = Math.round(
    Math.max(
      0,
      50 * pitchAccuracy +
        30 * timingAccuracy +
        20 * completeness -
        EXTRA_NOTE_PENALTY * extras.length,
    ),
  );

  return {
    matches,
    extras,
    pitchAccuracy,
    timingAccuracy,
    completeness,
    meanOffsetBeats,
    overall,
    verdict: verdictFor(overall),
  };
}

/**
 * Start offset of a take, in beats: the median of (played start − ref start)
 * over the first few reference notes matched by pitch class. Every pairing of
 * the first four reference notes with the first eight played notes that share
 * a pitch class casts a delta; the largest cluster of deltas within half a
 * beat of each other is the alignment (ties go to the smaller shift), so a
 * wrong or missed first note does not throw the estimate. 0 when nothing
 * matches.
 */
export function estimateOffset(
  reference: readonly RefNote[],
  played: readonly PlayedNote[],
): number {
  const refs = pick(reference, timeOrder(reference).slice(0, OFFSET_REFERENCE_NOTES));
  const takes = pick(played, timeOrder(played).slice(0, OFFSET_PLAYED_NOTES));
  const deltas: number[] = [];
  for (const ref of refs) {
    for (const note of takes) {
      if (samePitch(note.midi, ref.midi, true)) deltas.push(note.startBeat - ref.startBeat);
    }
  }
  if (deltas.length === 0) return 0;

  let best: number[] = [];
  let bestMedian = 0;
  for (const centre of deltas) {
    const cluster = deltas.filter((delta) => Math.abs(delta - centre) <= OFFSET_CLUSTER_BEATS);
    const clusterMedian = median(cluster);
    if (
      cluster.length > best.length ||
      (cluster.length === best.length && Math.abs(clusterMedian) < Math.abs(bestMedian))
    ) {
      best = cluster;
      bestMedian = clusterMedian;
    }
  }
  return bestMedian;
}

interface Candidate {
  index: number;
  note: PlayedNote;
  delta: number;
}

function verdictFor(overall: number): PracticeVerdict {
  if (overall >= VERDICT_THRESHOLDS.excellent) return 'excellent';
  if (overall >= VERDICT_THRESHOLDS.good) return 'good';
  return 'keep-practising';
}

function pitchClass(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

/** Indices of `notes` in ascending start order; equal starts keep their given order. */
function timeOrder(notes: readonly { startBeat: number }[]): number[] {
  const start = (index: number): number => notes[index]?.startBeat ?? 0;
  return notes.map((_, index) => index).sort((a, b) => start(a) - start(b) || a - b);
}

function pick<T>(items: readonly T[], indices: readonly number[]): T[] {
  const picked: T[] = [];
  for (const index of indices) {
    const item = items[index];
    if (item !== undefined) picked.push(item);
  }
  return picked;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[mid - 1] ?? upper;
  return (lower + upper) / 2;
}
