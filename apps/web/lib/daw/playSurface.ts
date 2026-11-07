/**
 * Play Surface geometry (Studio v3) — the pure helpers behind
 * components/daw/PlaySurface.tsx: piano-key layout in white-key units, the
 * scale-only bar layout, velocity from the vertical touch position, octave
 * clamping and durbaan pad labels. No DOM here; everything is unit-tested.
 */

import { midiName, scalePitchClasses } from './scales';
import { DURBAAN_LANES, type PentatonicMode } from './types';

/** Octave range of the leftmost C (scientific pitch: 4 → C4 = MIDI 60). */
export const SURFACE_OCTAVE_MIN = 1;
export const SURFACE_OCTAVE_MAX = 7;

/** Velocity at the top edge of a key / pad; the bottom edge is always 1. */
export const KEY_VELOCITY_MIN = 0.45;
export const PAD_VELOCITY_MIN = 0.35;

export interface KeyboardKey {
  midi: number;
  black: boolean;
  /** Left edge in white-key units (white keys sit at integers). */
  x: number;
  /** Width in white-key units: 1 for white keys, 0.6 for black keys. */
  w: number;
}

export interface ScaleBar {
  midi: number;
  /** 1..5 relative to the root (the root is degree 1). */
  degree: number;
  isRoot: boolean;
}

const BLACK_PITCH_CLASSES: ReadonlySet<number> = new Set([1, 3, 6, 8, 10]);

/** Octaves 1..7; non-numbers fall back to the middle octave (C4). */
export function clampOctave(o: number): number {
  if (!Number.isFinite(o)) return 4;
  return Math.min(SURFACE_OCTAVE_MAX, Math.max(SURFACE_OCTAVE_MIN, Math.round(o)));
}

/** MIDI number of the C that opens an octave (4 → 60). */
export function octaveBaseMidi(octave: number): number {
  return 12 * (Math.round(octave) + 1);
}

/**
 * Key geometry for `octaves` octaves from the C of `octave`, plus the top C.
 * White keys are 1 unit wide at integer x; black keys are 0.6 wide, centred on
 * the boundary between their white neighbours. Fractional octave counts (1.5)
 * end on the last white key below the cut so no black key hangs off the end,
 * and nothing runs past MIDI 127.
 */
export function keyboardLayout(octave: number, octaves: number): KeyboardKey[] {
  const start = octaveBaseMidi(octave);
  const span = Math.max(1, Math.round(12 * (Number.isFinite(octaves) ? octaves : 2)));
  const keys: KeyboardKey[] = [];
  let whites = 0;
  for (let i = 0; i <= span; i += 1) {
    const midi = start + i;
    if (midi < 0) continue;
    if (midi > 127) break;
    if (BLACK_PITCH_CLASSES.has(midi % 12)) {
      if (i === span) break;
      keys.push({ midi, black: true, x: whites - 0.3, w: 0.6 });
    } else {
      keys.push({ midi, black: false, x: whites, w: 1 });
      whites += 1;
    }
  }
  return keys;
}

/** Number of white keys — the layout's total width in white-key units. */
export function whiteKeyCount(keys: readonly KeyboardKey[]): number {
  return keys.reduce((n, key) => n + (key.black ? 0 : 1), 0);
}

/**
 * The in-scale pitches across the same range as `keyboardLayout`, ascending,
 * each with its degree. `scalePitchClasses` lists pitch classes in degree order
 * (root first), so the index is the degree.
 */
export function scaleOnlyLayout(
  octave: number,
  octaves: number,
  root: number,
  mode: PentatonicMode,
): ScaleBar[] {
  const keys = keyboardLayout(octave, octaves);
  const first = keys[0]?.midi;
  const last = keys[keys.length - 1]?.midi;
  if (first === undefined || last === undefined) return [];
  const degreeOrder = [...scalePitchClasses(root, mode)];
  const bars: ScaleBar[] = [];
  for (let midi = first; midi <= last; midi += 1) {
    const index = degreeOrder.indexOf(midi % 12);
    if (index === -1) continue;
    bars.push({ midi, degree: index + 1, isRoot: index === 0 });
  }
  return bars;
}

/**
 * Velocity from where a key was struck: `min` at the top edge, `max` at the
 * bottom, clamped; a degenerate height (hidden element) plays at `max`.
 */
export function velocityFromY(offsetY: number, height: number, min = 0.45, max = 1): number {
  if (!(height > 0) || !Number.isFinite(offsetY)) return max;
  const t = Math.min(1, Math.max(0, offsetY / height));
  return Math.round((min + (max - min) * t) * 1000) / 1000;
}

/** Durbaan stroke name for a pad's MIDI number, or null for anything else. */
export function padForMidi(midi: number): string | null {
  return DURBAAN_LANES.find((lane) => lane.midi === midi)?.label ?? null;
}

/** Octaves on screen for a container width: 3 from 900 px, 1.5 under 480 px, else 2. */
export function octavesForWidth(widthPx: number): number {
  if (!(widthPx > 0)) return 2;
  if (widthPx >= 900) return 3;
  if (widthPx < 480) return 1.5;
  return 2;
}

/** "C3 – C5" for the keys on screen. */
export function keyboardRangeLabel(keys: readonly KeyboardKey[]): string {
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (!first || !last) return '';
  return `${midiName(first.midi)} – ${midiName(last.midi)}`;
}
