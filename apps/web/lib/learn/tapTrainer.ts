/**
 * Tap trainer for the Learn panel (Studio v3) — rhythm practice against a
 * durbaan groove from `lib/daw/grooves` (16 steps per bar on the dum / tak /
 * slap lanes). Pure functions over plain data — no React, DOM or audio.
 *
 * Times are seconds from the start of the pattern (as the audio clock gives
 * them); errors and the tolerance are in milliseconds.
 *
 * expectedOnsets — step `s` of bar `b` sounds at
 *     (b · 16 + s) · (beatsPerBar / 16) · (60 / bpm) seconds,
 *   for every step whose velocity is above 0 on the chosen lane; lane 'all'
 *   is the union of the three lanes with a shared step counted once. Values
 *   are rounded to the microsecond. A non-positive bpm or bar count gives [].
 *
 * scoreTaps — one-to-one greedy nearest matching: every (onset, tap) pair
 *   within `toleranceMs` is a candidate; candidates are accepted smallest
 *   |error| first while both ends are still free. With E expected onsets,
 *   H hits and X extra taps:
 *     errorMs        = (tap − onset) · 1000, rounded to 0.1 ms (positive = late)
 *     meanAbsErrorMs = mean |errorMs| over hits (0 with none)
 *     bias           = mean signed errorMs < −15 → 'early', > +15 → 'late', else 'steady'
 *     precision      = clamp(1 − meanAbsErrorMs / (2 · toleranceMs), 0.5, 1)
 *     score          = round(clamp(70 · (H / E) · precision
 *                                 + 30 · clamp(1 − X / max(1, E), 0, 1), 0, 100))
 *   so perfect taps score 100, hits at the very edge of the tolerance halve the
 *   70-point share, each extra tap costs 30 / E points, and a round with no
 *   expected onsets or no hits at all scores 0 (silence earns nothing).
 *
 * bpmFromTaps — 60 / median inter-tap interval, rounded to 0.1 BPM; null with
 *   fewer than three taps (or fewer than two positive intervals).
 */

import { STEPS_PER_BAR, type GroovePreset } from '@/lib/daw/grooves';

/** A lane index into `GroovePreset.lanes` ([dum, tak, slap]) or every lane together. */
export type TapLane = 0 | 1 | 2 | 'all';

export interface TapHit {
  /** Expected onset, seconds from pattern start. */
  expected: number;
  /** The tap matched to it, seconds from pattern start. */
  tap: number;
  /** tap − expected in milliseconds, rounded to 0.1 ms; negative = early. */
  errorMs: number;
}

export interface TapResult {
  hits: TapHit[];
  /** Expected onsets with no tap, ascending. */
  misses: number[];
  /** Taps with no expected onset, ascending. */
  extras: number[];
  /** Mean |errorMs| over hits, 0 when none. */
  meanAbsErrorMs: number;
  /** Mean signed error < −15 ms early, > +15 ms late, else steady. */
  bias: 'early' | 'late' | 'steady';
  /** 0..100, rounded — see the file comment for the formula. */
  score: number;
}

export const DEFAULT_TAP_TOLERANCE_MS = 120;

/** |mean signed error| up to this many ms still reads as 'steady'. */
export const BIAS_THRESHOLD_MS = 15;

/** Onset times in seconds of a groove's hits on `lane`, over `bars` bars, ascending. */
export function expectedOnsets(
  preset: GroovePreset,
  lane: TapLane,
  bpm: number,
  beatsPerBar: number,
  bars: number,
): number[] {
  if (!(bpm > 0) || !(beatsPerBar > 0) || !(bars > 0)) return [];
  const stepSeconds = (beatsPerBar / STEPS_PER_BAR) * (60 / bpm);
  const lanes = lane === 'all' ? preset.lanes : [preset.lanes[lane]];
  const steps = new Set<number>();
  for (const velocities of lanes) {
    if (velocities === undefined) continue;
    velocities.forEach((velocity, step) => {
      if (velocity > 0 && step < STEPS_PER_BAR) steps.add(step);
    });
  }
  const onsets: number[] = [];
  const barCount = Math.floor(bars);
  for (let bar = 0; bar < barCount; bar += 1) {
    for (const step of [...steps].sort((a, b) => a - b)) {
      onsets.push(roundTo((bar * STEPS_PER_BAR + step) * stepSeconds, 1e6));
    }
  }
  return onsets;
}

/** Match `taps` to `expected` onsets (both in seconds) within `toleranceMs` and score the round. */
export function scoreTaps(
  taps: readonly number[],
  expected: readonly number[],
  toleranceMs: number = DEFAULT_TAP_TOLERANCE_MS,
): TapResult {
  const tolerance =
    Number.isFinite(toleranceMs) && toleranceMs > 0 ? toleranceMs : DEFAULT_TAP_TOLERANCE_MS;
  const toleranceSeconds = tolerance / 1000;
  const onsetTimes = finiteAscending(expected);
  const tapTimes = finiteAscending(taps);

  const candidates: Candidate[] = [];
  onsetTimes.forEach((onset, onsetIndex) => {
    tapTimes.forEach((tap, tapIndex) => {
      const error = tap - onset;
      if (Math.abs(error) <= toleranceSeconds) candidates.push({ onsetIndex, tapIndex, error });
    });
  });
  candidates.sort(
    (a, b) =>
      Math.abs(a.error) - Math.abs(b.error) ||
      a.onsetIndex - b.onsetIndex ||
      a.tapIndex - b.tapIndex,
  );

  const onsetTaken: boolean[] = new Array<boolean>(onsetTimes.length).fill(false);
  const tapTaken: boolean[] = new Array<boolean>(tapTimes.length).fill(false);
  const hits: TapHit[] = [];
  for (const candidate of candidates) {
    if (onsetTaken[candidate.onsetIndex] === true || tapTaken[candidate.tapIndex] === true)
      continue;
    const onset = onsetTimes[candidate.onsetIndex];
    const tap = tapTimes[candidate.tapIndex];
    if (onset === undefined || tap === undefined) continue;
    onsetTaken[candidate.onsetIndex] = true;
    tapTaken[candidate.tapIndex] = true;
    hits.push({ expected: onset, tap, errorMs: roundTo(candidate.error * 1000, 10) });
  }
  hits.sort((a, b) => a.expected - b.expected);
  const misses = onsetTimes.filter((_, index) => onsetTaken[index] !== true);
  const extras = tapTimes.filter((_, index) => tapTaken[index] !== true);

  const expectedCount = onsetTimes.length;
  const hitCount = hits.length;
  const meanSigned = hitCount > 0 ? hits.reduce((sum, hit) => sum + hit.errorMs, 0) / hitCount : 0;
  const meanAbsErrorMs =
    hitCount > 0 ? hits.reduce((sum, hit) => sum + Math.abs(hit.errorMs), 0) / hitCount : 0;
  const bias: TapResult['bias'] =
    meanSigned < -BIAS_THRESHOLD_MS ? 'early' : meanSigned > BIAS_THRESHOLD_MS ? 'late' : 'steady';

  let score = 0;
  if (expectedCount > 0 && hitCount > 0) {
    const precision = clamp(1 - meanAbsErrorMs / (2 * tolerance), 0.5, 1);
    const accuracyPart = 70 * (hitCount / expectedCount) * precision;
    const extrasPart = 30 * clamp(1 - extras.length / Math.max(1, expectedCount), 0, 1);
    score = Math.round(clamp(accuracyPart + extrasPart, 0, 100));
  }

  return { hits, misses, extras, meanAbsErrorMs, bias, score };
}

/** Tempo implied by a run of taps (seconds): 60 / median interval, to 0.1 BPM; null below three taps. */
export function bpmFromTaps(taps: readonly number[]): number | null {
  const times = finiteAscending(taps);
  if (times.length < 3) return null;
  const intervals: number[] = [];
  for (let i = 1; i < times.length; i += 1) {
    const previous = times[i - 1];
    const current = times[i];
    if (previous !== undefined && current !== undefined && current > previous) {
      intervals.push(current - previous);
    }
  }
  if (intervals.length < 2) return null;
  const interval = median(intervals);
  if (!(interval > 0)) return null;
  return roundTo(60 / interval, 10);
}

interface Candidate {
  onsetIndex: number;
  tapIndex: number;
  /** Seconds, tap − onset. */
  error: number;
}

function finiteAscending(values: readonly number[]): number[] {
  return values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function roundTo(value: number, scale: number): number {
  return Math.round(value * scale) / scale;
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
