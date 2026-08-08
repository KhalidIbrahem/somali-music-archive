/**
 * Qaraami scale lock (Stage 5 Tier 1) — selectable pentatonic modes + root.
 * When the lock is on, the piano roll only OFFERS in-scale rows; existing
 * out-of-scale notes still play (the lock guides writing, never destroys).
 */

import type { PentatonicMode } from './types';

export const PENTATONIC_MODES: ReadonlyArray<{
  id: PentatonicMode;
  label: string;
  /** Semitone offsets from the root pitch class. */
  degrees: readonly number[];
}> = [
  { id: 'major-pentatonic', label: 'Major pentatonic', degrees: [0, 2, 4, 7, 9] },
  { id: 'minor-pentatonic', label: 'Minor pentatonic', degrees: [0, 3, 5, 7, 10] },
  { id: 'suspended-pentatonic', label: 'Suspended pentatonic', degrees: [0, 2, 5, 7, 10] },
  { id: 'blues-minor-pentatonic', label: 'Blues minor pentatonic', degrees: [0, 3, 5, 8, 10] },
  { id: 'ritusen', label: 'Ritusen', degrees: [0, 2, 5, 7, 9] },
];

export const ROOT_NAMES = [
  'C',
  'C♯',
  'D',
  'E♭',
  'E',
  'F',
  'F♯',
  'G',
  'A♭',
  'A',
  'B♭',
  'B',
] as const;

export function scalePitchClasses(root: number, mode: PentatonicMode): Set<number> {
  const entry = PENTATONIC_MODES.find((m) => m.id === mode) ?? PENTATONIC_MODES[0]!;
  return new Set(entry.degrees.map((d) => (root + d) % 12));
}

export function isInScale(midi: number, root: number, mode: PentatonicMode): boolean {
  return scalePitchClasses(root, mode).has(((midi % 12) + 12) % 12);
}

/** Note name for a MIDI number, e.g. 69 → A4. */
export function midiName(midi: number): string {
  return `${ROOT_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
