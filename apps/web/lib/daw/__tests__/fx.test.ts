import { describe, expect, it } from 'vitest';
import {
  audibleGain,
  compMix,
  faderPosToGain,
  formatDb,
  formatPan,
  GAIN_MAX,
  gainToFaderPos,
  generateImpulse,
  resolveFx,
} from '../fx';
import { DEFAULT_FX } from '../types';

describe('resolveFx', () => {
  it('defaults to DEFAULT_FX', () => {
    expect(resolveFx(undefined)).toEqual({
      lowDb: 0,
      midDb: 0,
      highDb: 0,
      compEnabled: false,
      compThresholdDb: -18,
      compRatio: 3,
      reverbSend: 0.1,
    });
  });

  it('clamps out-of-range and non-finite values', () => {
    const fx = resolveFx({
      eq: { low: 40, mid: -40, high: Number.NaN },
      comp: { enabled: true, thresholdDb: 10, ratio: 100 },
      reverbSend: 3,
    });
    expect(fx).toMatchObject({
      lowDb: 12,
      midDb: -12,
      highDb: -12,
      compThresholdDb: 0,
      compRatio: 20,
      reverbSend: 1,
    });
  });

  it('does not mutate the shared default', () => {
    resolveFx(DEFAULT_FX);
    expect(DEFAULT_FX.eq.low).toBe(0);
  });
});

describe('fader law', () => {
  it('maps the ends and unity', () => {
    expect(faderPosToGain(0)).toBe(0);
    expect(faderPosToGain(1)).toBe(GAIN_MAX);
    expect(faderPosToGain(gainToFaderPos(1))).toBeCloseTo(1);
  });

  it('round-trips and clamps', () => {
    for (const g of [0.01, 0.25, 0.5, 1, 1.4])
      expect(faderPosToGain(gainToFaderPos(g))).toBeCloseTo(g);
    expect(gainToFaderPos(5)).toBe(1);
    expect(faderPosToGain(-1)).toBe(0);
  });

  it('formats dB and pan', () => {
    expect(formatDb(0)).toBe('-∞');
    expect(formatDb(1)).toBe('0.0');
    expect(formatDb(0.5)).toBe('-6.0');
    expect(formatDb(1.5)).toBe('+3.5');
    expect(formatPan(0)).toBe('C');
    expect(formatPan(-0.5)).toBe('L50');
    expect(formatPan(0.3)).toBe('R30');
  });
});

describe('switching and gating', () => {
  it('crossfades the compressor path', () => {
    expect(compMix(true)).toEqual({ dry: 0, wet: 1 });
    expect(compMix(false)).toEqual({ dry: 1, wet: 0 });
  });

  it('gates by mute and solo', () => {
    expect(audibleGain(false, false, false)).toBe(1);
    expect(audibleGain(true, false, false)).toBe(0);
    expect(audibleGain(false, false, true)).toBe(0);
    expect(audibleGain(true, true, true)).toBe(1);
  });
});

describe('generateImpulse', () => {
  it('is stereo, deterministic and decays ~60 dB over its length', () => {
    const sr = 8000;
    const [l, r] = generateImpulse(sr, 2.2);
    const [l2] = generateImpulse(sr, 2.2);
    expect(l.length).toBe(Math.ceil(sr * 2.2));
    expect(l).toEqual(l2);
    expect(l).not.toEqual(r);
    const energy = (from: number, to: number): number => {
      let s = 0;
      for (let i = from; i < to; i++) s += (l[i] ?? 0) ** 2;
      return s / (to - from);
    };
    const early = energy(200, 1000);
    const late = energy(l.length - 800, l.length);
    expect(10 * Math.log10(early / late)).toBeGreaterThan(40);
  });
});
