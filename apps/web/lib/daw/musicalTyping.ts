/**
 * Musical typing + Web MIDI input (Studio v2).
 *
 * GarageBand layout on the computer keyboard (physical key codes, so it works
 * on any keyboard layout):
 *
 *     W E   T Y U   O P
 *    A S D F G H J K L ; '
 *
 * A S D F G H J K = white keys C D E F G A B C, W E T Y U = the black keys,
 * K L ; ' carry on into the next octave. Z / X shift the octave, C / V the
 * velocity. Scale lock snaps a played pitch to the nearest in-scale pitch.
 */

import { isInScale } from './scales';
import type { DawProject } from './types';

/** Semitone offset above the current octave's C for each physical key. */
export const TYPING_NOTE_KEYS: Readonly<Record<string, number>> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
  Quote: 17,
};

export const TYPING_CONTROL_KEYS = ['KeyZ', 'KeyX', 'KeyC', 'KeyV'] as const;

export const OCTAVE_MIN = 0;
export const OCTAVE_MAX = 8;
export const VELOCITY_STEP = 0.1;
export const VELOCITY_MIN = 0.1;

export interface TypingState {
  /** Octave of the A key's C (scientific pitch: 4 → C4 = MIDI 60). */
  octave: number;
  /** 0.1–1. */
  velocity: number;
}

export const DEFAULT_TYPING: TypingState = { octave: 4, velocity: 0.8 };

export function isTypingKey(code: string): boolean {
  return code in TYPING_NOTE_KEYS || (TYPING_CONTROL_KEYS as readonly string[]).includes(code);
}

/** MIDI number for a key press, or null when the key is not a note key. */
export function typingNote(code: string, state: TypingState): number | null {
  if (!(code in TYPING_NOTE_KEYS)) return null;
  const offset = TYPING_NOTE_KEYS[code];
  if (offset === undefined) return null;
  const midi = 12 * (state.octave + 1) + offset;
  return midi >= 0 && midi <= 127 ? midi : null;
}

/** Z/X octave down/up, C/V velocity down/up; null when not a control key. */
export function typingControl(code: string, state: TypingState): TypingState | null {
  const round = (v: number): number => Math.round(v * 10) / 10;
  switch (code) {
    case 'KeyZ':
      return { ...state, octave: Math.max(OCTAVE_MIN, state.octave - 1) };
    case 'KeyX':
      return { ...state, octave: Math.min(OCTAVE_MAX, state.octave + 1) };
    case 'KeyC':
      return { ...state, velocity: Math.max(VELOCITY_MIN, round(state.velocity - VELOCITY_STEP)) };
    case 'KeyV':
      return { ...state, velocity: Math.min(1, round(state.velocity + VELOCITY_STEP)) };
    default:
      return null;
  }
}

/**
 * Honour the project's scale lock: an out-of-scale pitch moves to the nearest
 * in-scale pitch (ties resolve upwards). Lock off → unchanged.
 */
export function lockToScale(midi: number, scaleLock: DawProject['scaleLock']): number {
  if (!scaleLock.enabled || isInScale(midi, scaleLock.root, scaleLock.mode)) return midi;
  for (let distance = 1; distance <= 6; distance++) {
    const up = midi + distance;
    if (up <= 127 && isInScale(up, scaleLock.root, scaleLock.mode)) return up;
    const down = midi - distance;
    if (down >= 0 && isInScale(down, scaleLock.root, scaleLock.mode)) return down;
  }
  return midi;
}

export type MidiInputEvent =
  { type: 'on'; midi: number; velocity: number } | { type: 'off'; midi: number };

/** Parse a raw Web MIDI message (any channel) into note on/off, else null. */
export function parseMidiMessage(data: ArrayLike<number> | null): MidiInputEvent | null {
  if (data === null || data.length < 3) return null;
  const status = (data[0] ?? 0) & 0xf0;
  const midi = data[1] ?? 0;
  const velocity = data[2] ?? 0;
  if (status === 0x90 && velocity > 0) return { type: 'on', midi, velocity: velocity / 127 };
  if (status === 0x80 || (status === 0x90 && velocity === 0)) return { type: 'off', midi };
  return null;
}
