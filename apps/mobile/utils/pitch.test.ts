import { detectPitch, centsFromTarget, pitchAccuracy } from './pitch';

/** Generate `n` samples of a sine at `freq` Hz. */
function sine(freq: number, sampleRate: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * freq * i) / sampleRate));
}

describe('detectPitch', () => {
  it('recovers the frequency of a clean sine wave', () => {
    const hz = detectPitch(sine(440, 44100, 4096), 44100);
    expect(hz).not.toBeNull();
    expect(hz as number).toBeGreaterThan(430);
    expect(hz as number).toBeLessThan(450);
  });

  it('recovers a lower note (D4 ≈ 293.66 Hz)', () => {
    const hz = detectPitch(sine(293.66, 44100, 8192), 44100);
    expect(hz as number).toBeGreaterThan(288);
    expect(hz as number).toBeLessThan(300);
  });

  it('returns null for silence', () => {
    expect(detectPitch(new Array(2048).fill(0), 44100)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(detectPitch([], 44100)).toBeNull();
  });
});

describe('centsFromTarget', () => {
  it('is 0 when in tune', () => {
    expect(centsFromTarget(440, 440)).toBeCloseTo(0, 6);
  });

  it('is +1200 an octave up', () => {
    expect(centsFromTarget(880, 440)).toBeCloseTo(1200, 6);
  });

  it('is negative when flat', () => {
    expect(centsFromTarget(430, 440)).toBeLessThan(0);
  });
});

describe('pitchAccuracy', () => {
  it('scores a perfect match at 100 and in-tune', () => {
    const result = pitchAccuracy(440, 440);
    expect(result.accuracy).toBe(100);
    expect(result.inTune).toBe(true);
    expect(result.cents).toBe(0);
  });

  it('drops accuracy as the note drifts and marks out of tune', () => {
    const result = pitchAccuracy(466.16, 440); // ~+100 cents (a semitone sharp)
    expect(result.accuracy).toBeLessThanOrEqual(1);
    expect(result.inTune).toBe(false);
  });

  it('treats a small deviation as in tune', () => {
    const result = pitchAccuracy(443, 440); // ~+12 cents
    expect(result.inTune).toBe(true);
    expect(result.accuracy).toBeGreaterThan(85);
  });
});
