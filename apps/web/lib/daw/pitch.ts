/**
 * Pitch lens — measured pitch of an audio region, read against a fitted
 * pentatonic grid instead of being forced onto 12-TET.
 *
 * The method mirrors the research transcription pipeline at browser scale:
 *   1. f0 per 10 ms frame (YIN on an ~11 kHz mono downmix; the research uses
 *      CREPE, so numbers here are estimates, not the paper's scorer);
 *   2. the recording's tuning offset from A440 (circular weighted mean of the
 *      cents residue — cassette speed errors live here);
 *   3. the best of the 12 anhemitonic pentatonic sets, the tonic as its most
 *      sounded degree (with an ambiguity flag), the mode as that rotation;
 *   4. each degree placed at the weighted median of the pitches within 60 c of
 *      its template position; a degree under 2 % of the mass is "not refined";
 *   5. note events from stable voiced runs, each keeping its measured cents
 *      deviation and a confidence, off-scale notes marked rather than snapped.
 *
 * Pure functions; the only async one yields to the event loop for progress
 * and cancellation.
 */

import { PENTATONIC_MODES } from './scales';
import type { PentatonicMode } from './types';

export const ANALYSIS_RATE_TARGET = 11025;
const QUARTER_TONE = 50;
const REFINE_WINDOW = 60;
const REFINE_MIN_SHARE = 0.02;

export interface PitchFrame {
  /** Seconds from the start of the analysed span. */
  t: number;
  /** Null when unvoiced or below the level gate. */
  hz: number | null;
  /** 1 − YIN aperiodicity, 0–1. */
  clarity: number;
  /** Frame RMS, dBFS. */
  db: number;
}

export interface TrackOptions {
  hopSec?: number;
  windowSec?: number;
  fminHz?: number;
  fmaxHz?: number;
  /** Frames quieter than this are unvoiced. */
  gateDb?: number;
  /** Minimum clarity for a voiced frame. */
  minClarity?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Mono downmix + box-filter decimation to ~11 kHz. */
export function downmix(
  channels: readonly Float32Array[],
  sampleRate: number,
  startSec = 0,
  endSec = Number.POSITIVE_INFINITY,
): { samples: Float32Array; rate: number } {
  const factor = Math.max(1, Math.round(sampleRate / ANALYSIS_RATE_TARGET));
  const length = channels[0]?.length ?? 0;
  const from = Math.max(0, Math.floor(startSec * sampleRate));
  const to = Math.min(length, Math.floor(Math.min(endSec, length / sampleRate) * sampleRate));
  const n = Math.max(0, Math.floor((to - from) / factor));
  const out = new Float32Array(n);
  const scale = 1 / (factor * Math.max(1, channels.length));
  for (const ch of channels) {
    for (let i = 0; i < n; i++) {
      let acc = 0;
      const base = from + i * factor;
      for (let k = 0; k < factor; k++) acc += ch[base + k] ?? 0;
      out[i] = (out[i] ?? 0) + acc * scale;
    }
  }
  return { samples: out, rate: sampleRate / factor };
}

/**
 * YIN on one frame: `x` holds window + tauMax samples. Returns the f0 and
 * clarity of the first dip under the threshold (else the global minimum).
 */
export function yin(
  x: Float32Array,
  offset: number,
  window: number,
  tauMin: number,
  tauMax: number,
  rate: number,
  threshold = 0.2,
): { hz: number; clarity: number } | null {
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let j = 0; j < window; j++) {
      const diff = (x[offset + j] ?? 0) - (x[offset + j + tau] ?? 0);
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  // Cumulative mean normalised difference.
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau] ?? 0;
    cmnd[tau] = running > 0 ? ((d[tau] ?? 0) * tau) / running : 1;
  }
  let best = -1;
  for (let tau = Math.max(2, tauMin); tau < tauMax; tau++) {
    if ((cmnd[tau] ?? 1) < threshold) {
      while (tau + 1 < tauMax && (cmnd[tau + 1] ?? 1) < (cmnd[tau] ?? 1)) tau++;
      best = tau;
      break;
    }
  }
  if (best < 0) {
    let min = Number.POSITIVE_INFINITY;
    for (let tau = Math.max(2, tauMin); tau < tauMax; tau++) {
      if ((cmnd[tau] ?? 1) < min) {
        min = cmnd[tau] ?? 1;
        best = tau;
      }
    }
  }
  if (best <= 0) return null;
  // Parabolic interpolation around the dip.
  const a = cmnd[best - 1] ?? 1;
  const b = cmnd[best] ?? 1;
  const c = cmnd[best + 1] ?? 1;
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  const period = best + Math.max(-1, Math.min(1, shift));
  return { hz: rate / period, clarity: Math.max(0, Math.min(1, 1 - b)) };
}

/** f0 track over a mono signal, 10 ms hop by default. */
export async function trackPitch(
  samples: Float32Array,
  rate: number,
  options: TrackOptions = {},
): Promise<PitchFrame[]> {
  const hop = Math.max(1, Math.round((options.hopSec ?? 0.01) * rate));
  const window = Math.max(64, Math.round((options.windowSec ?? 0.046) * rate));
  const tauMax = Math.ceil(rate / (options.fminHz ?? 70));
  const tauMin = Math.max(2, Math.floor(rate / (options.fmaxHz ?? 1000)));
  const gateDb = options.gateDb ?? -45;
  const minClarity = options.minClarity ?? 0.75;
  const total = Math.max(0, Math.floor((samples.length - window - tauMax) / hop) + 1);
  const frames: PitchFrame[] = [];
  for (let i = 0; i < total; i++) {
    if (i % 250 === 0) {
      if (options.signal?.aborted) throw new DOMException('analysis cancelled', 'AbortError');
      options.onProgress?.(i / Math.max(1, total));
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    const offset = i * hop;
    let energy = 0;
    for (let j = 0; j < window; j++) energy += (samples[offset + j] ?? 0) ** 2;
    const db = 10 * Math.log10(energy / window + 1e-12);
    const t = (offset + window / 2) / rate;
    if (db < gateDb) {
      frames.push({ t, hz: null, clarity: 0, db });
      continue;
    }
    const r = yin(samples, offset, window, tauMin, tauMax, rate);
    const voiced = r !== null && r.clarity >= minClarity;
    frames.push({ t, hz: voiced ? r.hz : null, clarity: r?.clarity ?? 0, db });
  }
  options.onProgress?.(1);
  return frames;
}

/** Cents above A4 (440 Hz). */
export function hzToCents(hz: number): number {
  return 1200 * Math.log2(hz / 440);
}

/** Wrap cents into [−50, 50). */
function residue(cents: number): number {
  return ((((cents + 50) % 100) + 100) % 100) - 50;
}

/** Tuning offset from A440/12-TET, cents in [−50, 50): circular mean, clarity-weighted. */
export function tuningOffset(frames: readonly PitchFrame[]): number {
  let sx = 0;
  let sy = 0;
  for (const f of frames) {
    if (f.hz === null) continue;
    const angle = (residue(hzToCents(f.hz)) / 100) * 2 * Math.PI;
    sx += Math.cos(angle) * f.clarity;
    sy += Math.sin(angle) * f.clarity;
  }
  if (sx === 0 && sy === 0) return 0;
  return residue((Math.atan2(sy, sx) / (2 * Math.PI)) * 100);
}

export interface DegreeProfile {
  /** Semitones above the tonic in the 12-TET template. */
  template: number;
  /** Measured deviation from the template, cents (null = not refined). */
  deviationCents: number | null;
  /** Share of voiced pitch mass within 60 c of the template. */
  share: number;
}

export interface PentatonicFit {
  tonic: number;
  mode: PentatonicMode;
  modeLabel: string;
  /** Semitone offsets of the mode from the tonic. */
  degrees: readonly number[];
  /** Runner-up tonic's mass / winner's, ≥ 0.95 = ambiguous. */
  tonicRatio: number;
  tonicAmbiguous: boolean;
  profile: DegreeProfile[];
  /** Share of voiced frames within a quarter tone of a refined degree. */
  withinQuarterTone: number;
  voicedFrames: number;
}

/** Position of a frame in cents above C, after removing the tuning offset, in [0, 1200). */
function chromaCents(hz: number, offset: number): number {
  const c = hzToCents(hz) - offset + 900; // A4 = 900 c above C
  return ((c % 1200) + 1200) % 1200;
}

function circDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 1200;
  return Math.min(d, 1200 - d);
}

function weightedMedian(values: Array<{ v: number; w: number }>): number {
  const sorted = [...values].sort((x, y) => x.v - y.v);
  const half = sorted.reduce((s, x) => s + x.w, 0) / 2;
  let acc = 0;
  for (const x of sorted) {
    acc += x.w;
    if (acc >= half) return x.v;
  }
  return sorted[sorted.length - 1]?.v ?? 0;
}

export function fitPentatonic(frames: readonly PitchFrame[], offset: number): PentatonicFit | null {
  const voiced = frames.filter((f): f is PitchFrame & { hz: number } => f.hz !== null);
  if (voiced.length < 20) return null;
  const hist = new Array<number>(12).fill(0);
  const points = voiced.map((f) => ({
    c: chromaCents(f.hz, offset),
    w: Math.max(0.05, f.clarity),
  }));
  for (const p of points) hist[Math.round(p.c / 100) % 12]! += p.w;
  const major = PENTATONIC_MODES[0]!.degrees;
  let bestRoot = 0;
  let bestMass = -1;
  for (let root = 0; root < 12; root++) {
    const mass = major.reduce((s, d) => s + (hist[(root + d) % 12] ?? 0), 0);
    if (mass > bestMass) {
      bestMass = mass;
      bestRoot = root;
    }
  }
  const members = major.map((d) => (bestRoot + d) % 12);
  const ranked = [...members].sort((a, b) => (hist[b] ?? 0) - (hist[a] ?? 0));
  const tonic = ranked[0] ?? bestRoot;
  const tonicRatio = (hist[ranked[1] ?? tonic] ?? 0) / Math.max(1e-9, hist[tonic] ?? 0);
  const intervals = members.map((m) => (m - tonic + 12) % 12).sort((a, b) => a - b);
  const mode =
    PENTATONIC_MODES.find((m) => m.degrees.every((d, i) => d === intervals[i])) ??
    PENTATONIC_MODES[0]!;

  const totalW = points.reduce((s, p) => s + p.w, 0);
  const profile: DegreeProfile[] = mode.degrees.map((template) => {
    const centre = ((tonic + template) % 12) * 100;
    const near = points
      .filter((p) => circDist(p.c, centre) <= REFINE_WINDOW)
      .map((p) => {
        let dv = p.c - centre;
        if (dv > 600) dv -= 1200;
        if (dv < -600) dv += 1200;
        return { v: dv, w: p.w };
      });
    const share = near.reduce((s, x) => s + x.w, 0) / Math.max(1e-9, totalW);
    return {
      template,
      share,
      deviationCents: share >= REFINE_MIN_SHARE ? weightedMedian(near) : null,
    };
  });
  const grid = profile.map((d) => ((tonic + d.template) % 12) * 100 + (d.deviationCents ?? 0));
  const within = points.filter((p) => grid.some((g) => circDist(p.c, g) <= QUARTER_TONE)).length;
  return {
    tonic,
    mode: mode.id,
    modeLabel: mode.label,
    degrees: mode.degrees,
    tonicRatio,
    tonicAmbiguous: tonicRatio >= 0.95,
    profile,
    withinQuarterTone: within / voiced.length,
    voicedFrames: voiced.length,
  };
}

export interface MeasuredNote {
  start: number;
  end: number;
  /** Nearest semitone after removing the tuning offset. */
  midi: number;
  /** Measured median minus (midi + offset), cents. */
  deviationCents: number;
  /** Mean clarity of the note's frames, 0–1. */
  confidence: number;
  /** Pitch class outside the fitted pentatonic set. */
  offScale: boolean;
  /** Mean level, dBFS. */
  db: number;
}

/** Note events from stable voiced runs (min 80 ms; a 60 c jump starts a new note). */
export function segmentNotes(
  frames: readonly PitchFrame[],
  offset: number,
  fit: Pick<PentatonicFit, 'tonic' | 'degrees'> | null,
  minDurSec = 0.08,
): MeasuredNote[] {
  const notes: MeasuredNote[] = [];
  const scale = fit ? new Set(fit.degrees.map((d) => (fit.tonic + d) % 12)) : null;
  let run: PitchFrame[] = [];
  let gap = 0;
  const flush = (): void => {
    if (run.length === 0) return;
    const first = run[0]!;
    const last = run[run.length - 1]!;
    const step = run.length > 1 ? (last.t - first.t) / (run.length - 1) : 0.01;
    if (last.t - first.t + step >= minDurSec) {
      const cents = run.map((f) => hzToCents(f.hz ?? 440)).sort((a, b) => a - b);
      const median = cents[Math.floor(cents.length / 2)] ?? 0;
      const midi = Math.round((median - offset) / 100) + 69;
      notes.push({
        start: first.t - step / 2,
        end: last.t + step / 2,
        midi,
        deviationCents: Math.round(median - offset - (midi - 69) * 100),
        confidence: run.reduce((s, f) => s + f.clarity, 0) / run.length,
        offScale: scale !== null && !scale.has(((midi % 12) + 12) % 12),
        db: run.reduce((s, f) => s + f.db, 0) / run.length,
      });
    }
    run = [];
  };
  for (const f of frames) {
    if (f.hz === null) {
      if (++gap > 2) flush();
      continue;
    }
    gap = 0;
    if (run.length > 0) {
      const recent = run
        .slice(-5)
        .map((r) => hzToCents(r.hz ?? 440))
        .sort((a, b) => a - b);
      const ref = recent[Math.floor(recent.length / 2)] ?? 0;
      if (Math.abs(hzToCents(f.hz) - ref) > REFINE_WINDOW) flush();
    }
    run.push(f);
  }
  flush();
  return notes;
}

export interface PitchAnalysis {
  durationSec: number;
  frames: PitchFrame[];
  offsetCents: number;
  fit: PentatonicFit | null;
  notes: MeasuredNote[];
}

/** Whole pipeline over decoded channels (a region's span of a file). */
export async function analysePitch(
  channels: readonly Float32Array[],
  sampleRate: number,
  span: { startSec: number; endSec: number },
  options: TrackOptions = {},
): Promise<PitchAnalysis> {
  const { samples, rate } = downmix(channels, sampleRate, span.startSec, span.endSec);
  const frames = await trackPitch(samples, rate, options);
  const offsetCents = tuningOffset(frames);
  const fit = fitPentatonic(frames, offsetCents);
  const notes = segmentNotes(frames, offsetCents, fit);
  return { durationSec: samples.length / rate, frames, offsetCents, fit, notes };
}
