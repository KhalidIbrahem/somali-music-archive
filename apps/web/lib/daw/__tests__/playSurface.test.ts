import { describe, expect, it } from 'vitest';
import {
  KEY_VELOCITY_MIN,
  PAD_VELOCITY_MIN,
  clampOctave,
  keyboardLayout,
  keyboardRangeLabel,
  octaveBaseMidi,
  octavesForWidth,
  padForMidi,
  scaleOnlyLayout,
  velocityFromY,
  whiteKeyCount,
} from '../playSurface';
import { midiName } from '../scales';

describe('keyboardLayout', () => {
  it('two octaves from C4 are 15 white + 10 black keys, C4 to C6', () => {
    const keys = keyboardLayout(4, 2);
    expect(keys).toHaveLength(25);
    expect(keys.filter((k) => !k.black)).toHaveLength(15);
    expect(keys.filter((k) => k.black)).toHaveLength(10);
    expect(keys[0]?.midi).toBe(60);
    expect(keys[keys.length - 1]?.midi).toBe(84);
    expect(whiteKeyCount(keys)).toBe(15);
  });

  it('lays white keys at integer x, width 1, in ascending order', () => {
    const whites = keyboardLayout(3, 2).filter((k) => !k.black);
    whites.forEach((key, index) => {
      expect(key.x).toBe(index);
      expect(key.w).toBe(1);
    });
    expect(whites.map((k) => k.midi % 12)).toEqual([0, 2, 4, 5, 7, 9, 11, 0, 2, 4, 5, 7, 9, 11, 0]);
  });

  it('centres each black key (width 0.6) on the boundary between its white neighbours', () => {
    const keys = keyboardLayout(3, 2);
    const byMidi = new Map(keys.map((k) => [k.midi, k]));
    const blacks = keys.filter((k) => k.black);
    expect(blacks.map((k) => k.midi % 12)).toEqual([1, 3, 6, 8, 10, 1, 3, 6, 8, 10]);
    for (const black of blacks) {
      const below = byMidi.get(black.midi - 1);
      const above = byMidi.get(black.midi + 1);
      expect(below?.black).toBe(false);
      expect(above?.black).toBe(false);
      expect(black.w).toBeCloseTo(0.6);
      const centre = black.x + black.w / 2;
      expect(centre).toBeCloseTo((below?.x ?? Number.NaN) + 1);
      expect(centre).toBeCloseTo(above?.x ?? Number.NaN);
    }
  });

  it('scales to 3 octaves and ends 1.5 octaves on the last white key', () => {
    const three = keyboardLayout(2, 3);
    expect(three.filter((k) => !k.black)).toHaveLength(22);
    expect(three.filter((k) => k.black)).toHaveLength(15);
    expect(three[three.length - 1]?.midi).toBe(36 + 36); // C5

    const half = keyboardLayout(4, 1.5);
    expect(half.filter((k) => !k.black)).toHaveLength(11);
    expect(half.filter((k) => k.black)).toHaveLength(7);
    expect(half[half.length - 1]?.black).toBe(false);
    expect(midiName(half[half.length - 1]?.midi ?? -1)).toBe('F5');
  });

  it('never runs past MIDI 127', () => {
    const keys = keyboardLayout(7, 3);
    expect(keys[keys.length - 1]?.midi).toBe(127);
    expect(keys.every((k) => k.midi <= 127)).toBe(true);
  });

  it('starts at the C of the given octave', () => {
    expect(octaveBaseMidi(4)).toBe(60);
    expect(octaveBaseMidi(1)).toBe(24);
    expect(keyboardLayout(1, 1)[0]?.midi).toBe(24);
  });
});

describe('scaleOnlyLayout', () => {
  it('lists A minor pentatonic across C4–C6 as A C D E G with A as degree 1', () => {
    const bars = scaleOnlyLayout(4, 2, 9, 'minor-pentatonic');
    expect(bars.map((b) => midiName(b.midi))).toEqual([
      'C4',
      'D4',
      'E4',
      'G4',
      'A4',
      'C5',
      'D5',
      'E5',
      'G5',
      'A5',
      'C6',
    ]);
    expect(bars.map((b) => b.degree)).toEqual([2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2]);
    expect(bars.filter((b) => b.isRoot).map((b) => b.midi)).toEqual([69, 81]);
    expect(bars.every((b) => b.isRoot === (b.degree === 1))).toBe(true);
  });

  it('is ascending and only holds in-scale pitches', () => {
    const bars = scaleOnlyLayout(3, 3, 2, 'major-pentatonic'); // D E F♯ A B
    const pcs = new Set([2, 4, 6, 9, 11]);
    expect(bars.every((b) => pcs.has(b.midi % 12))).toBe(true);
    for (let i = 1; i < bars.length; i += 1) {
      expect((bars[i]?.midi ?? 0) > (bars[i - 1]?.midi ?? 0)).toBe(true);
    }
    expect(bars[0]?.midi).toBe(50); // D3 — the C3 start is out of scale
  });
});

describe('velocityFromY', () => {
  it('maps top → min and bottom → max, linearly', () => {
    expect(velocityFromY(0, 100)).toBe(KEY_VELOCITY_MIN);
    expect(velocityFromY(100, 100)).toBe(1);
    expect(velocityFromY(50, 100)).toBeCloseTo(0.725);
    expect(velocityFromY(0, 80, PAD_VELOCITY_MIN)).toBe(PAD_VELOCITY_MIN);
    expect(velocityFromY(40, 80, 0.5, 0.9)).toBeCloseTo(0.7);
  });

  it('clamps outside the key and survives a zero height', () => {
    expect(velocityFromY(-20, 100)).toBe(KEY_VELOCITY_MIN);
    expect(velocityFromY(500, 100)).toBe(1);
    expect(velocityFromY(10, 0)).toBe(1);
    expect(velocityFromY(Number.NaN, 100)).toBe(1);
  });
});

describe('clampOctave', () => {
  it('keeps octaves within 1..7', () => {
    expect(clampOctave(0)).toBe(1);
    expect(clampOctave(1)).toBe(1);
    expect(clampOctave(4)).toBe(4);
    expect(clampOctave(7)).toBe(7);
    expect(clampOctave(12)).toBe(7);
    expect(clampOctave(3.6)).toBe(4);
    expect(clampOctave(Number.NaN)).toBe(4);
  });
});

describe('padForMidi', () => {
  it('names the durbaan lanes and nothing else', () => {
    expect(padForMidi(36)).toBe('Dum');
    expect(padForMidi(38)).toBe('Tak');
    expect(padForMidi(42)).toBe('Slap');
    expect(padForMidi(60)).toBeNull();
  });
});

describe('octavesForWidth and the range label', () => {
  it('picks 3 octaves from 900 px, 1.5 under 480 px, else 2', () => {
    expect(octavesForWidth(0)).toBe(2);
    expect(octavesForWidth(320)).toBe(1.5);
    expect(octavesForWidth(479)).toBe(1.5);
    expect(octavesForWidth(480)).toBe(2);
    expect(octavesForWidth(899)).toBe(2);
    expect(octavesForWidth(900)).toBe(3);
  });

  it('labels the keys on screen', () => {
    expect(keyboardRangeLabel(keyboardLayout(3, 2))).toBe('C3 – C5');
    expect(keyboardRangeLabel(keyboardLayout(4, 1.5))).toBe('C4 – F5');
    expect(keyboardRangeLabel([])).toBe('');
  });
});
