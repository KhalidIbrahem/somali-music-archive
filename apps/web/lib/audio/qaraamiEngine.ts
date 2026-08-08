/**
 * Qaraami performance engine (SESSION "studio master plan") — the shared
 * oud + durbaan synthesis extracted VERBATIM from the Beerdilaacshe
 * ScorePlayer so every surface performs from one implementation:
 * the score page, the landing-page research demos, and (Stage 5) the DAW's
 * oud instrument. Pure DSP — no React, no DOM, no AudioContext ownership;
 * callers decide how to play the rendered samples.
 *
 * Voices:
 *  • oud — Karplus-Strong plucked string, doubled course ±5 cents with a
 *    0.006 s pick offset and a faint octave-below resonance.
 *  • durbaan — swept-sine dum, highpass-noise tak, in a 4/4 frame-drum
 *    groove (dum · tak · ghost · dum · tak) at the score's own tempo.
 */

export interface ScoreNote {
  midi: number;
  start: number;
  end: number;
  velocity: number;
}

export interface ScoreData {
  bpm: number;
  timeSignature: string;
  durationSec: number;
  noteCount: number;
  notes: ScoreNote[];
}

/** Render sample rate — matches the original ScorePlayer render. */
export const ENGINE_SAMPLE_RATE = 24000;
const SR = ENGINE_SAMPLE_RATE;
/** Seconds of decay tail after the last note. */
export const ENGINE_TAIL_SEC = 2.0;

/** One Karplus-Strong pluck added into `out` at `at` seconds. */
export function pluck(
  out: Float32Array,
  at: number,
  freq: number,
  seconds: number,
  gain: number,
  seed: number,
): void {
  const N = Math.max(2, Math.round(SR / freq));
  const line = new Float32Array(N);
  let s = seed >>> 0;
  for (let i = 0; i < N; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    line[i] = (s / 0xffffffff) * 2 - 1;
  }
  const s0 = Math.floor(at * SR);
  const len = Math.min(out.length - s0, Math.floor(seconds * SR));
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const cur = line[idx] ?? 0;
    const nxt = line[(idx + 1) % N] ?? 0;
    out[s0 + i] = (out[s0 + i] ?? 0) + cur * gain * Math.exp((-2.4 * i) / SR / seconds);
    line[idx] = 0.9955 * 0.5 * (cur + nxt);
    idx = (idx + 1) % N;
  }
}

/** Low dum: membrane hit — sine sweeping down with a soft noise front. */
export function dum(out: Float32Array, at: number, gain: number): void {
  const s0 = Math.floor(at * SR);
  const len = Math.min(out.length - s0, Math.floor(0.22 * SR));
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = 92 * Math.exp(-t * 9) + 52;
    phase += (2 * Math.PI * f) / SR;
    const env = Math.exp(-t * 22);
    const noise = (Math.random() * 2 - 1) * Math.exp(-t * 180) * 0.25;
    out[s0 + i] = (out[s0 + i] ?? 0) + (Math.sin(phase) + noise) * gain * env;
  }
}

/** High tak: rim/edge stroke — short bright noise snap. */
export function tak(out: Float32Array, at: number, gain: number): void {
  const s0 = Math.floor(at * SR);
  const len = Math.min(out.length - s0, Math.floor(0.06 * SR));
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const n = Math.random() * 2 - 1;
    hp = 0.86 * (hp + n - prev); // one-pole highpass keeps only the snap
    prev = n;
    out[s0 + i] = (out[s0 + i] ?? 0) + hp * gain * Math.exp((-i / SR) * 70);
  }
}

/** Add one oud note (doubled course + faint lower octave) into `out`. */
export function oudNote(out: Float32Array, note: ScoreNote): void {
  const f = 440 * Math.pow(2, (note.midi - 69) / 12);
  const ring = Math.min(2.5, Math.max(0.5, note.end - note.start + 0.35));
  const g = 0.32 * (0.55 + 0.45 * note.velocity);
  pluck(out, note.start, f * Math.pow(2, -5 / 1200), ring, g, note.midi * 2654435761);
  pluck(out, note.start + 0.006, f * Math.pow(2, 5 / 1200), ring, g * 0.8, note.midi * 40503 + 7);
  pluck(out, note.start + 0.003, f / 2, ring * 0.8, g * 0.16, note.midi * 69069 + 13);
}

/** Lay the 4/4 durbaan groove (dum·tak·ghost·dum·tak) across `durationSec`. */
export function durbaanGroove(out: Float32Array, bpm: number, durationSec: number): void {
  const beat = 60 / bpm;
  for (let t0 = 0; t0 < durationSec - 0.05; t0 += 4 * beat) {
    dum(out, t0, 0.34);
    tak(out, t0 + 1 * beat, 0.2);
    tak(out, t0 + 1.75 * beat, 0.09);
    dum(out, t0 + 2 * beat, 0.22);
    tak(out, t0 + 3 * beat, 0.2);
  }
}

/** Peak-normalise in place to `target` (headroom below full scale). */
export function normalize(out: Float32Array, target = 0.86): void {
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) {
    const k = target / peak;
    for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) * k;
  }
}

/**
 * Render the full oud + durbaan performance to mono samples at
 * ENGINE_SAMPLE_RATE. ~200 ms for the 87 s Beerdilaacshe score — fine to run
 * inside a click handler (the original player does exactly that).
 */
export function renderPerformance(data: ScoreData): Float32Array {
  const out = new Float32Array(Math.ceil((data.durationSec + ENGINE_TAIL_SEC) * SR));
  for (const note of data.notes) oudNote(out, note);
  durbaanGroove(out, data.bpm, data.durationSec);
  normalize(out);
  return out;
}

/** Wrap rendered samples in an AudioBuffer for a given context. */
export function toAudioBuffer(ctx: BaseAudioContext, samples: Float32Array): AudioBuffer {
  const buffer = ctx.createBuffer(1, samples.length, SR);
  buffer.getChannelData(0).set(samples);
  return buffer;
}
