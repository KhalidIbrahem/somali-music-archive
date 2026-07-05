/**
 * Pitch analysis for the lesson pitch-exercise (ARCHITECTURE.md §7, §10).
 *
 * Pure and unit-tested: autocorrelation pitch detection, plus the cents/accuracy
 * scoring against a target note. This mirrors the AI service's scale mapping (the
 * cents math is the platform's research core) and is the single source of truth for
 * "how close was that note?". The detected frequency is fed in by the mic capture
 * layer, keeping this module free of any native audio dependency.
 *
 * It also derives the pitch-contour sparkline shown on the recording detail screen
 * from the AI service's stored PitchPoint[] (SESSION P3-06) — normalised here so the
 * rendering component (PitchContour) stays a thin SVG wrapper.
 */

import type { PitchPoint } from '@sma/types';

/**
 * Estimate the fundamental frequency (Hz) of a mono PCM window by autocorrelation.
 * Returns null for silence/noise (below the RMS gate) or when no clear period is
 * found. Searches the ~50–1000 Hz band that covers sung/played notes.
 */
export function detectPitch(samples: readonly number[], sampleRate: number): number | null {
  const n = samples.length;
  if (n < 2 || sampleRate <= 0) return null;

  // Remove DC offset.
  let mean = 0;
  for (const s of samples) mean += s;
  mean /= n;

  const buf = samples.map((s) => s - mean);

  // Silence gate via RMS.
  let sumSq = 0;
  for (const s of buf) sumSq += s * s;
  const rms = Math.sqrt(sumSq / n);
  if (rms < 0.01) return null;

  const minLag = Math.max(1, Math.floor(sampleRate / 1000));
  const maxLag = Math.min(n - 1, Math.floor(sampleRate / 50));

  let bestLag = -1;
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0;
    for (let i = 0; i + lag < n; i += 1) {
      corr += (buf[i] ?? 0) * (buf[i + lag] ?? 0);
    }
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  if (bestLag <= 0) return null;
  return sampleRate / bestLag;
}

/** Deviation of a frequency from a target, in cents (0 = perfectly in tune). */
export function centsFromTarget(hz: number, targetHz: number): number {
  if (hz <= 0 || targetHz <= 0) return 0;
  return 1200 * Math.log2(hz / targetHz);
}

export interface PitchAccuracy {
  /** Signed cents deviation (negative = flat, positive = sharp). */
  cents: number;
  /** 0–100 closeness score (100 = spot on, 0 = a semitone or more off). */
  accuracy: number;
  /** Within a comfortable tolerance (±15 cents). */
  inTune: boolean;
}

/** Score a detected frequency against a target note. */
export function pitchAccuracy(hz: number, targetHz: number): PitchAccuracy {
  const cents = centsFromTarget(hz, targetHz);
  const accuracy = Math.max(0, Math.min(100, 100 - Math.abs(cents)));
  return {
    cents: Math.round(cents * 10) / 10,
    accuracy: Math.round(accuracy),
    inTune: Math.abs(cents) <= 15,
  };
}

// ── Pitch-contour sparkline (SESSION P3-06) ──────────────────────────────────

/** A point on the normalised contour: both axes 0–1, y=0 lowest pitch, y=1 highest. */
export interface ContourPoint {
  x: number;
  y: number;
}

/** Average a series into at most `buckets` values (mean of each contiguous bucket). */
export function downsample(values: readonly number[], buckets: number): number[] {
  if (buckets <= 0) return [];
  if (values.length <= buckets) return [...values];
  const size = values.length / buckets;
  const out: number[] = [];
  for (let b = 0; b < buckets; b += 1) {
    const start = Math.floor(b * size);
    const end = Math.floor((b + 1) * size);
    let sum = 0;
    for (let i = start; i < end; i += 1) sum += values[i] ?? 0;
    out.push(sum / Math.max(1, end - start));
  }
  return out;
}

/**
 * Turn stored PitchPoints into a normalised contour for the sparkline. Drops
 * silent/low-confidence frames, downsamples to keep the line legible, and scales
 * frequency to 0–1 across the recording's own range. Returns [] when there is not
 * enough voiced pitch to draw a line.
 */
export function buildPitchContour(points: readonly PitchPoint[], maxPoints = 48): ContourPoint[] {
  const voiced = points
    .filter((p) => p.frequencyHz > 0 && (p.confidence === undefined || p.confidence >= 0.5))
    .map((p) => p.frequencyHz);
  if (voiced.length < 2) return [];

  const series = downsample(voiced, maxPoints);
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1; // flat line when every frame is the same pitch
  const lastIndex = series.length - 1;
  return series.map((hz, i) => ({
    x: lastIndex === 0 ? 0 : i / lastIndex,
    y: (hz - min) / range,
  }));
}

/** Voiced fraction (0–1) as a whole percentage for display. */
export function voicedPercent(fraction: number): number {
  return Math.round(Math.max(0, Math.min(1, fraction)) * 100);
}
