/**
 * Pitch analysis for the lesson pitch-exercise (ARCHITECTURE.md §7, §10).
 *
 * Pure and unit-tested: autocorrelation pitch detection, plus the cents/accuracy
 * scoring against a target note. This mirrors the AI service's scale mapping (the
 * cents math is the platform's research core) and is the single source of truth for
 * "how close was that note?". The detected frequency is fed in by the mic capture
 * layer, keeping this module free of any native audio dependency.
 */

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
