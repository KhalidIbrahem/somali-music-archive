import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TYPING,
  isTypingKey,
  lockToScale,
  parseMidiMessage,
  typingControl,
  typingNote,
} from '../musicalTyping';
import { matchShortcut, SHORTCUTS, type KeyLike } from '../shortcuts';

describe('musical typing — GarageBand layout', () => {
  it('maps the home row to white keys from C', () => {
    const codes = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'];
    expect(codes.map((c) => typingNote(c, DEFAULT_TYPING))).toEqual([
      60, 62, 64, 65, 67, 69, 71, 72,
    ]);
  });

  it('maps W E T Y U to the black keys', () => {
    const codes = ['KeyW', 'KeyE', 'KeyT', 'KeyY', 'KeyU'];
    expect(codes.map((c) => typingNote(c, DEFAULT_TYPING))).toEqual([61, 63, 66, 68, 70]);
  });

  it('continues into the next octave on O L P ; ’', () => {
    expect(typingNote('KeyO', DEFAULT_TYPING)).toBe(73);
    expect(typingNote('KeyL', DEFAULT_TYPING)).toBe(74);
    expect(typingNote('Quote', DEFAULT_TYPING)).toBe(77);
  });

  it('returns null for non-note keys', () => {
    expect(typingNote('KeyQ', DEFAULT_TYPING)).toBeNull();
    expect(typingNote('KeyZ', DEFAULT_TYPING)).toBeNull();
  });

  it('Z/X shift the octave within bounds', () => {
    const down = typingControl('KeyZ', DEFAULT_TYPING);
    expect(down?.octave).toBe(3);
    expect(typingNote('KeyA', down ?? DEFAULT_TYPING)).toBe(48);
    expect(typingControl('KeyX', DEFAULT_TYPING)?.octave).toBe(5);
    expect(typingControl('KeyZ', { octave: 0, velocity: 0.5 })?.octave).toBe(0);
    expect(typingControl('KeyX', { octave: 8, velocity: 0.5 })?.octave).toBe(8);
  });

  it('C/V step velocity within 0.1–1', () => {
    expect(typingControl('KeyC', DEFAULT_TYPING)?.velocity).toBe(0.7);
    expect(typingControl('KeyV', DEFAULT_TYPING)?.velocity).toBe(0.9);
    expect(typingControl('KeyV', { octave: 4, velocity: 1 })?.velocity).toBe(1);
    expect(typingControl('KeyC', { octave: 4, velocity: 0.1 })?.velocity).toBe(0.1);
    expect(typingControl('KeyA', DEFAULT_TYPING)).toBeNull();
  });

  it('knows its keys', () => {
    expect(isTypingKey('KeyA')).toBe(true);
    expect(isTypingKey('KeyV')).toBe(true);
    expect(isTypingKey('KeyR')).toBe(false);
  });
});

describe('scale lock for played notes', () => {
  const lock = { enabled: true, root: 9, mode: 'minor-pentatonic' as const }; // A C D E G

  it('keeps in-scale notes', () => {
    expect(lockToScale(69, lock)).toBe(69); // A4
    expect(lockToScale(72, lock)).toBe(72); // C5
  });

  it('moves out-of-scale notes to the nearest in-scale pitch, ties upward', () => {
    expect(lockToScale(70, lock)).toBe(69); // B♭ → A (1 below) vs C (2 above)
    expect(lockToScale(71, lock)).toBe(72); // B → C
    expect(lockToScale(61, lock)).toBe(62); // C♯ → D (tie with C → up)
  });

  it('is a no-op when the lock is off', () => {
    expect(lockToScale(70, { ...lock, enabled: false })).toBe(70);
  });
});

describe('Web MIDI parsing', () => {
  it('parses note on/off on any channel', () => {
    expect(parseMidiMessage([0x90, 60, 127])).toEqual({ type: 'on', midi: 60, velocity: 1 });
    expect(parseMidiMessage([0x93, 64, 0])).toEqual({ type: 'off', midi: 64 });
    expect(parseMidiMessage([0x81, 64, 40])).toEqual({ type: 'off', midi: 64 });
  });

  it('ignores everything else', () => {
    expect(parseMidiMessage([0xb0, 1, 64])).toBeNull();
    expect(parseMidiMessage([0xf8])).toBeNull();
    expect(parseMidiMessage(null)).toBeNull();
  });
});

describe('shortcuts', () => {
  const key = (over: Partial<KeyLike>): KeyLike => ({
    key: '',
    code: '',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...over,
  });

  it('matches the documented keys', () => {
    expect(matchShortcut(key({ code: 'KeyZ', key: 'z', metaKey: true }))).toBe('undo');
    expect(matchShortcut(key({ code: 'KeyZ', key: 'z', ctrlKey: true }))).toBe('undo');
    expect(matchShortcut(key({ code: 'KeyZ', key: 'Z', metaKey: true, shiftKey: true }))).toBe(
      'redo',
    );
    expect(matchShortcut(key({ code: 'KeyT', metaKey: true }))).toBe('split');
    expect(matchShortcut(key({ code: 'KeyD', metaKey: true }))).toBe('duplicate');
    expect(matchShortcut(key({ code: 'Space', key: ' ' }))).toBe('play');
    expect(matchShortcut(key({ key: 'Enter', code: 'Enter' }))).toBe('toStart');
    expect(matchShortcut(key({ key: 'Backspace', code: 'Backspace' }))).toBe('delete');
    expect(matchShortcut(key({ code: 'KeyM', key: 'µ', altKey: true }))).toBe('addMarker');
    expect(matchShortcut(key({ key: '?', code: 'Slash', shiftKey: true }))).toBe('help');
    expect(matchShortcut(key({ key: 'ArrowLeft', code: 'ArrowLeft' }))).toBe('barBack');
    expect(matchShortcut(key({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }))).toBe(
      'prevMarker',
    );
    expect(matchShortcut(key({ code: 'Equal', key: '=', metaKey: true }))).toBe('zoomIn');
    expect(matchShortcut(key({ code: 'KeyC', key: 'c' }))).toBe('cycle');
    expect(matchShortcut(key({ code: 'KeyK', key: 'k' }))).toBe('metronome');
  });

  it('requires exact modifiers', () => {
    expect(matchShortcut(key({ code: 'KeyZ', key: 'z' }))).toBeNull();
    expect(matchShortcut(key({ code: 'KeyD', key: 'd' }))).toBeNull();
  });

  it('yields plain letters to musical typing while it is on', () => {
    const typing = { musicalTyping: true };
    expect(matchShortcut(key({ code: 'KeyC', key: 'c' }), typing)).toBeNull();
    expect(matchShortcut(key({ code: 'KeyK', key: 'k' }), typing)).toBeNull();
    expect(matchShortcut(key({ code: 'KeyS', key: 's' }), typing)).toBeNull();
    expect(matchShortcut(key({ code: 'KeyR', key: 'r' }), typing)).toBe('record');
    expect(matchShortcut(key({ code: 'KeyC', key: 'c', metaKey: true }), typing)).toBe('copy');
  });

  it('lists every actionable id exactly once', () => {
    const ids = SHORTCUTS.flatMap((s) => (s.id === null ? [] : [s.id]));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
