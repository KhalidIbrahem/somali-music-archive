/**
 * Phrase splitting for the Learn panel (Studio v3) — cuts a melody (in beats)
 * into bar-aligned phrases a learner can practise one at a time.
 *
 * Rules:
 *   • A boundary falls on every `barsPerPhrase`-th bar line (default every
 *     2 bars), counted from the bar group that holds the first note.
 *   • A rest of at least `restGapBeats` (default 1.5) between consecutive
 *     notes also closes a phrase. The cut is snapped to the first bar line at
 *     or after the rest's start — the end of the last note sounding before it
 *     — when that line lies inside the current bar group; when it coincides
 *     with the group's own boundary nothing changes. (A held note that is
 *     still sounding masks a gap between shorter notes above it.)
 *   • Each note belongs to the phrase whose span contains its start; spans
 *     are bar-aligned and half-open, [startBeat, endBeat).
 *   • Phrases with no notes are dropped and the rest re-numbered: `index` is
 *     the position in the returned array and `label` is "Phrase index+1".
 * Everything is already in beats here (seconds are converted upstream).
 * Notes with a non-finite start are ignored; a non-positive `beatsPerBar`
 * falls back to 4 and `barsPerPhrase` is rounded and floored at 1.
 */

import type { RefNote } from './practiceScore';

export interface Phrase {
  /** Position in the returned array (0-based); `label` shows it 1-based. */
  index: number;
  /** Bar-aligned span, half-open: notes with startBeat in [startBeat, endBeat). */
  startBeat: number;
  endBeat: number;
  /** The phrase's notes in time order. */
  notes: RefNote[];
  /** "Phrase 1", "Phrase 2", … */
  label: string;
}

export interface PhraseOptions {
  /** Bars per phrase before any rest-induced cut; default 2. */
  barsPerPhrase?: number;
  /** A silence at least this long (beats) between notes closes a phrase; default 1.5. */
  restGapBeats?: number;
}

export const DEFAULT_PHRASE_OPTIONS: Readonly<Required<PhraseOptions>> = {
  barsPerPhrase: 2,
  restGapBeats: 1.5,
};

/** Relative slack when snapping a beat position onto a bar line (float noise such as 7.7 + 0.3). */
const EPS = 1e-9;

export function splitIntoPhrases(
  notes: readonly RefNote[],
  beatsPerBar: number,
  options?: PhraseOptions,
): Phrase[] {
  const bar = Number.isFinite(beatsPerBar) && beatsPerBar > 0 ? beatsPerBar : 4;
  const barsPerPhrase = Math.max(
    1,
    Math.round(options?.barsPerPhrase ?? DEFAULT_PHRASE_OPTIONS.barsPerPhrase),
  );
  const restGap = options?.restGapBeats ?? DEFAULT_PHRASE_OPTIONS.restGapBeats;
  const group = bar * barsPerPhrase;

  const sorted = notes
    .filter((note) => Number.isFinite(note.startBeat))
    .sort((a, b) => a.startBeat - b.startBeat);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return [];

  let lastEnd = first.startBeat;
  for (const note of sorted) lastEnd = Math.max(lastEnd, noteEnd(note));

  // Regular boundaries: the bar groups that cover every note start and end.
  const firstGroup = Math.floor(first.startBeat / group + EPS);
  const lastGroup = Math.max(
    Math.ceil(lastEnd / group - EPS),
    Math.floor(last.startBeat / group + EPS) + 1,
  );
  const boundaries = new Set<number>();
  for (let k = firstGroup; k <= lastGroup; k += 1) boundaries.add(k * group);

  // Rest-induced boundaries, measured from the end of everything sounding so far.
  let soundingUntil = noteEnd(first);
  for (let i = 1; i < sorted.length; i += 1) {
    const note = sorted[i];
    if (note === undefined) continue;
    const restStart = soundingUntil;
    soundingUntil = Math.max(soundingUntil, noteEnd(note));
    if (note.startBeat - restStart < restGap) continue;
    const line = Math.ceil(restStart / bar - EPS) * bar;
    const groupStart = Math.floor(restStart / group + EPS) * group;
    const groupEnd = groupStart + group;
    if (line > groupStart + EPS && line < groupEnd - EPS) boundaries.add(line);
  }

  const lines = [...boundaries].sort((a, b) => a - b);
  const phrases: Phrase[] = [];
  for (let i = 0; i + 1 < lines.length; i += 1) {
    const startBeat = lines[i];
    const endBeat = lines[i + 1];
    if (startBeat === undefined || endBeat === undefined) continue;
    const inSpan = sorted.filter((note) => note.startBeat >= startBeat && note.startBeat < endBeat);
    if (inSpan.length === 0) continue;
    const index = phrases.length;
    phrases.push({ index, startBeat, endBeat, notes: inSpan, label: `Phrase ${index + 1}` });
  }
  return phrases;
}

function noteEnd(note: RefNote): number {
  const length = Number.isFinite(note.lengthBeats) && note.lengthBeats > 0 ? note.lengthBeats : 0;
  return note.startBeat + length;
}
