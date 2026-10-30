/**
 * Tempo from note onsets. For each candidate tempo, the onsets are folded onto
 * an eighth-note grid and their circular alignment measured (1 = every onset
 * on the grid, 0 = no relation). A broad preference around 100 BPM settles
 * the octave ambiguity (90 and 180 BPM fit eighth notes equally well). One
 * global tempo: rubato and tempo changes lower the confidence, and the page
 * lets the musician correct the number.
 */

export interface TempoEstimate {
  bpm: number;
  /** Time of a beat (seconds), modulo the beat length. */
  phaseSec: number;
  /** Grid alignment at the chosen tempo, 0..1. */
  confidence: number;
}

export interface TempoOptions {
  minBpm?: number;
  maxBpm?: number;
  preferredBpm?: number;
}

function alignment(onsets: readonly number[], period: number): { r: number; angle: number } {
  let c = 0;
  let s = 0;
  for (const t of onsets) {
    const a = (2 * Math.PI * t) / period;
    c += Math.cos(a);
    s += Math.sin(a);
  }
  return { r: Math.hypot(c, s) / onsets.length, angle: Math.atan2(s, c) };
}

export function estimateTempo(
  onsets: readonly number[],
  { minBpm = 60, maxBpm = 180, preferredBpm = 100 }: TempoOptions = {},
): TempoEstimate | null {
  if (onsets.length < 4) return null;
  let best: { bpm: number; score: number; r: number } | null = null;
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.5) {
    const { r } = alignment(onsets, 60 / bpm / 2);
    const octaves = Math.log2(bpm / preferredBpm);
    const score = r * Math.exp(-0.5 * (octaves / 0.6) ** 2);
    if (best === null || score > best.score) best = { bpm, score, r };
  }
  if (best === null) return null;
  const beat = 60 / best.bpm;
  const { angle } = alignment(onsets, beat);
  const phaseSec = ((((angle / (2 * Math.PI)) * beat) % beat) + beat) % beat;
  return { bpm: best.bpm, phaseSec, confidence: best.r };
}

function sampleAt(x: Float32Array, at: number): number {
  const i = Math.floor(at);
  if (i < 0 || i + 1 >= x.length) return 0;
  const f = at - i;
  return x[i]! * (1 - f) + x[i + 1]! * f;
}

/**
 * Tempo from an onset-strength envelope (one value per `hopSec`): the
 * envelope's autocorrelation at the beat lag, plus half weight at half and
 * double the lag, times the same preference around 100 BPM. The beat phase is
 * the offset whose comb of beat-spaced samples holds the most onset strength.
 * Uses every attack in the recording (drums too), not only melody notes.
 */
export function estimateTempoFromEnvelope(
  envelope: Float32Array,
  hopSec: number,
  { minBpm = 60, maxBpm = 180, preferredBpm = 100 }: TempoOptions = {},
): TempoEstimate | null {
  const n = envelope.length;
  if (n * hopSec < 4) return null;
  let mean = 0;
  for (const v of envelope) mean += v;
  mean /= n;
  const x = Float32Array.from(envelope, (v) => v - mean);
  let ac0 = 0;
  for (const v of x) ac0 += v * v;
  if (ac0 <= 0) return null;
  const maxLag = Math.ceil((2 * 60) / minBpm / hopSec) + 2;
  const ac = new Float32Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag && lag < n; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i]! * x[i + lag]!;
    ac[lag] = s / ac0;
  }
  let best: { bpm: number; score: number; lag: number } | null = null;
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.5) {
    const lag = 60 / bpm / hopSec;
    const strength = sampleAt(ac, lag) + 0.5 * sampleAt(ac, lag / 2) + 0.5 * sampleAt(ac, 2 * lag);
    const octaves = Math.log2(bpm / preferredBpm);
    const score = strength * Math.exp(-0.5 * (octaves / 0.6) ** 2);
    if (best === null || score > best.score) best = { bpm, score, lag };
  }
  if (best === null || best.score <= 0) return null;
  let bestPhase = 0;
  let bestSum = -Infinity;
  for (let p = 0; p < best.lag; p++) {
    let s = 0;
    for (let at = p; at < n; at += best.lag) s += sampleAt(envelope, at);
    if (s > bestSum) {
      bestSum = s;
      bestPhase = p;
    }
  }
  return {
    bpm: best.bpm,
    phaseSec: bestPhase * hopSec,
    confidence: Math.max(0, Math.min(1, sampleAt(ac, best.lag))),
  };
}
