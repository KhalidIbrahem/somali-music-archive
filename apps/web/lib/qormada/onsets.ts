/**
 * Repeated-note splitting. The pitch segmenter (lib/daw/pitch.ts) starts a new
 * note only when the pitch moves or the sound stops, so an oud player plucking
 * the same string three times reads as one long note. A pluck shows up as a
 * jump in loudness after a decay; this splits a note wherever the level rises
 * by `riseDb` over the quietest of the preceding few frames.
 */

import type { MeasuredNote, PitchFrame } from '@/lib/daw/pitch';

export interface SplitOptions {
  /** Level rise, in dB over the recent minimum, that counts as a new pluck. */
  riseDb?: number;
  /** Frames looked back for that minimum (10 ms each). */
  lookback?: number;
  /** Neither part of a split may be shorter than this. */
  minDurSec?: number;
}

export function splitRepeatedNotes(
  notes: readonly MeasuredNote[],
  frames: readonly PitchFrame[],
  { riseDb = 6, lookback = 5, minDurSec = 0.08 }: SplitOptions = {},
): MeasuredNote[] {
  const out: MeasuredNote[] = [];
  let fi = 0;
  for (const note of notes) {
    while (fi < frames.length && frames[fi]!.t < note.start) fi++;
    const inside: PitchFrame[] = [];
    for (let j = fi; j < frames.length && frames[j]!.t <= note.end; j++) inside.push(frames[j]!);
    let partStart = note.start;
    for (let k = lookback; k < inside.length; k++) {
      const f = inside[k]!;
      let quietest = Infinity;
      for (let b = k - lookback; b < k; b++) quietest = Math.min(quietest, inside[b]!.db);
      const rise = f.db - quietest;
      if (rise >= riseDb && f.t - partStart >= minDurSec && note.end - f.t >= minDurSec) {
        out.push({ ...note, start: partStart, end: f.t });
        partStart = f.t;
      }
    }
    out.push({ ...note, start: partStart, end: note.end });
  }
  return out;
}
