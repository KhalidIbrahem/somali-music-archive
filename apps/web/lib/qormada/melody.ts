/**
 * Melody-focused analysis for transcription. In a full mix the pitch tracker
 * locks onto the bass, so the downmix is also tracked high-passed with the
 * pitch floor raised to the melody's range. When the two pitch tracks agree
 * (one voice or instrument, nothing underneath) and the direct track hears at
 * least as many voiced frames, the direct track is kept: the high-pass would
 * cut a low singer's fundamental. Otherwise a bass is pulling the direct track
 * away (or adds nothing) and the high-passed one is kept. Measured
 * in docs/QORMADA_EVAL.md. After segmentation, single notes
 * that jump an octave away from their neighbours (a classic pitch-tracker
 * error) are moved back by the octave. Also returns an onset-strength envelope
 * of the whole recording (drum and pluck attacks) for the tempo estimate.
 */

import {
  downmix,
  fitPentatonic,
  segmentNotes,
  trackPitch,
  tuningOffset,
  type MeasuredNote,
  type PitchAnalysis,
  type PitchFrame,
  type TrackOptions,
} from '@/lib/daw/pitch';

export const MELODY_FMIN_HZ = 100;
export const HIGHPASS_HZ = 150;
export const ENVELOPE_HOP_SEC = 0.01;
/** Share of frames voiced in both tracks that must agree within 50 c to keep the direct track. */
export const DIRECT_AGREEMENT = 0.9;

export interface MelodyOptions extends TrackOptions {
  /** High-pass cutoff before tracking (default HIGHPASS_HZ). */
  highpassHz?: number;
  /** Choose between the direct and high-passed tracks (default true); false = high-passed only. */
  adaptive?: boolean;
}

export interface MelodyAnalysis extends PitchAnalysis {
  /** Onset strength per 10 ms hop over the analysed span. */
  envelope: Float32Array;
  /** Notes moved by an octave to rejoin their neighbours. */
  octaveFixes: number;
  /** Which pitch track the notes come from. */
  source: 'direct' | 'highpassed';
  /** Agreement of the two tracks (null when only the high-passed one ran). */
  agreement: number | null;
}

/** Share of frames voiced in both tracks whose pitches are within 50 cents. */
export function trackAgreement(a: readonly PitchFrame[], b: readonly PitchFrame[]): number {
  let both = 0;
  let same = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i]!.hz;
    const y = b[i]!.hz;
    if (x === null || y === null) continue;
    both++;
    if (Math.abs(1200 * Math.log2(x / y)) < 50) same++;
  }
  return both === 0 ? 0 : same / both;
}

/** 2nd-order Butterworth high-pass (RBJ biquad), in place on a copy. */
export function highpass(x: Float32Array, rate: number, cutoffHz: number): Float32Array {
  const w = (2 * Math.PI * cutoffHz) / rate;
  const alpha = Math.sin(w) / Math.SQRT2;
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0;
  const b1 = -(1 + cos) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    const out = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = out;
    y[i] = out;
  }
  return y;
}

/**
 * Onset strength: half-wave-rectified rise of log energy in three bands
 * (low, mid, high), summed, per hop. Drum hits and plucks both show.
 */
export function onsetEnvelope(
  x: Float32Array,
  rate: number,
  hopSec = ENVELOPE_HOP_SEC,
): Float32Array {
  const hop = Math.max(1, Math.round(hopSec * rate));
  const frames = Math.floor(x.length / hop);
  const env = new Float32Array(frames);
  // Crude band split: one-pole low-pass at ~200 Hz and ~2 kHz.
  const k1 = Math.exp((-2 * Math.PI * 200) / rate);
  const k2 = Math.exp((-2 * Math.PI * 2000) / rate);
  let lp1 = 0;
  let lp2 = 0;
  const prev = [0, 0, 0];
  for (let f = 0; f < frames; f++) {
    const e = [1e-9, 1e-9, 1e-9];
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      const v = x[i]!;
      lp1 = (1 - k1) * v + k1 * lp1;
      lp2 = (1 - k2) * v + k2 * lp2;
      const low = lp1;
      const mid = lp2 - lp1;
      const high = v - lp2;
      e[0]! += low * low;
      e[1]! += mid * mid;
      e[2]! += high * high;
    }
    let rise = 0;
    for (let b = 0; b < 3; b++) {
      const l = Math.log10(e[b]!);
      if (f > 0) rise += Math.max(0, l - prev[b]!);
      prev[b] = l;
    }
    env[f] = rise;
  }
  return env;
}

/** Move lone octave jumps back next to their neighbours (median of ±3 notes). */
export function fixOctaveJumps(notes: readonly MeasuredNote[]): {
  notes: MeasuredNote[];
  fixes: number;
} {
  let fixes = 0;
  const out = notes.map((n, i) => {
    const around = notes
      .slice(Math.max(0, i - 3), i + 4)
      .filter((_, j) => j !== Math.min(i, 3))
      .map((m) => m.midi)
      .sort((a, b) => a - b);
    if (around.length < 2) return n;
    const ref = around[Math.floor(around.length / 2)]!;
    const gap = n.midi - ref;
    if (Math.abs(gap) < 9) return n;
    const shift = gap > 0 ? -12 : 12;
    if (Math.abs(n.midi + shift - ref) < Math.abs(gap)) {
      fixes++;
      return { ...n, midi: n.midi + shift };
    }
    return n;
  });
  return { notes: out, fixes };
}

export async function analyseMelody(
  channels: readonly Float32Array[],
  sampleRate: number,
  span: { startSec: number; endSec: number },
  options: MelodyOptions = {},
): Promise<MelodyAnalysis> {
  const { highpassHz = HIGHPASS_HZ, adaptive = true, onProgress, ...track } = options;
  const { samples, rate } = downmix(channels, sampleRate, span.startSec, span.endSec);
  const envelope = onsetEnvelope(samples, rate);
  // Two passes = 4th order (24 dB per octave): a 55 Hz bass drops to about 2 %.
  const filtered = highpass(highpass(samples, rate, highpassHz), rate, highpassHz);
  const share = adaptive ? 0.5 : 1;
  const highpassed = await trackPitch(filtered, rate, {
    fminHz: MELODY_FMIN_HZ,
    ...track,
    onProgress: (f) => onProgress?.(f * share),
  });
  let frames = highpassed;
  let source: MelodyAnalysis['source'] = 'highpassed';
  let agreement: number | null = null;
  if (adaptive) {
    // The direct track keeps the tracker's own low floor (a low singer's fundamental).
    const directOptions: TrackOptions = {
      ...track,
      onProgress: (f) => onProgress?.(0.5 + f * 0.5),
    };
    delete directOptions.fminHz;
    const direct = await trackPitch(samples, rate, directOptions);
    agreement = trackAgreement(highpassed, direct);
    const voiced = (fs: readonly PitchFrame[]): number => fs.filter((f) => f.hz !== null).length;
    if (agreement >= DIRECT_AGREEMENT && voiced(direct) >= voiced(highpassed)) {
      frames = direct;
      source = 'direct';
    }
  }
  const offsetCents = tuningOffset(frames);
  const fit = fitPentatonic(frames, offsetCents);
  const raw = segmentNotes(frames, offsetCents, fit);
  const { notes: moved, fixes } = fixOctaveJumps(raw);
  // Octave moves keep the pitch class, so off-scale flags stay valid.
  return {
    durationSec: samples.length / rate,
    frames,
    offsetCents,
    fit,
    notes: moved,
    envelope,
    octaveFixes: fixes,
    source,
    agreement,
  };
}
