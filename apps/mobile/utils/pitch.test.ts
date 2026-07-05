import type { PitchPoint } from '@sma/types';
import {
  detectPitch,
  centsFromTarget,
  pitchAccuracy,
  buildPitchContour,
  downsample,
  voicedPercent,
} from './pitch';

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

// ── Pitch-contour sparkline (SESSION P3-06) ──────────────────────────────────

function point(frequencyHz: number, confidence?: number): PitchPoint {
  return {
    timeSec: 0,
    frequencyHz,
    noteLabel: 'do',
    centsDeviation: 0,
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

describe('downsample', () => {
  it('returns the values unchanged when already within the budget', () => {
    expect(downsample([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });

  it('averages contiguous buckets down to the requested count', () => {
    expect(downsample([0, 2, 4, 6], 2)).toEqual([1, 5]);
  });

  it('handles a zero budget', () => {
    expect(downsample([1, 2, 3], 0)).toEqual([]);
  });
});

describe('buildPitchContour', () => {
  it('normalises frequency to 0–1 across the recording range', () => {
    const contour = buildPitchContour([point(200), point(300), point(400)]);
    expect(contour[0]).toEqual({ x: 0, y: 0 }); // lowest pitch
    expect(contour[contour.length - 1]).toEqual({ x: 1, y: 1 }); // highest pitch
    expect(contour[1]?.y).toBeCloseTo(0.5); // midpoint
  });

  it('drops unvoiced and low-confidence frames', () => {
    const contour = buildPitchContour([
      point(0), // silence
      point(220, 0.2), // low confidence
      point(300, 0.9),
      point(360, 0.9),
    ]);
    expect(contour).toHaveLength(2);
  });

  it('returns an empty contour when there is not enough voiced pitch', () => {
    expect(buildPitchContour([point(0), point(220, 0.1)])).toEqual([]);
    expect(buildPitchContour([])).toEqual([]);
  });

  it('produces a flat line when every frame is the same pitch', () => {
    const contour = buildPitchContour([point(300), point(300), point(300)]);
    expect(contour.every((p) => p.y === 0)).toBe(true);
  });

  it('downsamples a long series to the point budget', () => {
    const many = Array.from({ length: 500 }, (_, i) => point(200 + i));
    expect(buildPitchContour(many, 40)).toHaveLength(40);
  });
});

describe('voicedPercent', () => {
  it('rounds a 0–1 fraction to a whole percentage', () => {
    expect(voicedPercent(0.723)).toBe(72);
  });

  it('clamps out-of-range input', () => {
    expect(voicedPercent(1.4)).toBe(100);
    expect(voicedPercent(-0.2)).toBe(0);
  });
});
