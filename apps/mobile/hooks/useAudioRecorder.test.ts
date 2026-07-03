// Mock expo-av so importing the recorder module (which references Audio enums at
// load time for its WAV options) does not require the native module.
jest.mock('expo-av', () => ({
  Audio: {
    AndroidOutputFormat: { DEFAULT: 0 },
    AndroidAudioEncoder: { DEFAULT: 0 },
    IOSAudioQuality: { MAX: 127 },
    IOSOutputFormat: { LINEARPCM: 'lpcm' },
  },
}));

import { normalizeMeter } from './useAudioRecorder';

describe('normalizeMeter', () => {
  it('maps 0 dB (peak) to 1', () => {
    expect(normalizeMeter(0)).toBe(1);
  });

  it('maps the -60 dB floor to 0', () => {
    expect(normalizeMeter(-60)).toBe(0);
  });

  it('maps mid-level -30 dB to ~0.5', () => {
    expect(normalizeMeter(-30)).toBeCloseTo(0.5, 5);
  });

  it('clamps very quiet input to 0', () => {
    expect(normalizeMeter(-200)).toBe(0);
  });

  it('is defensive against non-finite input', () => {
    expect(normalizeMeter(Number.NaN)).toBe(0);
    expect(normalizeMeter(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});
