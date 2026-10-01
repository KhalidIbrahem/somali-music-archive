/**
 * Per-track insert FX and the master section (Studio v2).
 *
 * Track strip (one per track, built by buildTrackStrip):
 *
 *   input → EQ low shelf 200 Hz → peak 1 kHz (Q 0.9) → high shelf 5 kHz
 *         ┬→ dry ──────────────┬→ fader → mute → pan → analyser → master bus
 *         └→ compressor → wet ─┘                    └→ reverb send → reverb bus
 *
 * The compressor sits on a parallel path and is switched by crossfading the
 * dry/wet gains, so toggling it never clicks or rebuilds the graph. The send
 * is post-fader, post-pan. Every parameter update ramps with setTargetAtTime.
 *
 * Master: master bus gain → limiter (DynamicsCompressor −1 dB, 20:1, 1 ms
 * attack) → analyser → destination. The reverb return feeds the master bus.
 *
 * The pure mapping functions at the top are the single source of truth for
 * parameter ranges (the mixer UI and the engine both use them).
 */

import type { TrackFx } from './types';
import { DEFAULT_FX } from './types';

// ── parameter mapping (pure) ─────────────────────────────────────────────────

export const EQ_MIN_DB = -12;
export const EQ_MAX_DB = 12;
export const EQ_LOW_HZ = 200;
export const EQ_MID_HZ = 1000;
export const EQ_MID_Q = 0.9;
export const EQ_HIGH_HZ = 5000;
export const COMP_THRESHOLD_MIN_DB = -60;
export const COMP_THRESHOLD_MAX_DB = 0;
export const COMP_RATIO_MIN = 1;
export const COMP_RATIO_MAX = 20;
export const REVERB_DECAY_SEC = 2.2;
export const LIMITER = { thresholdDb: -1, ratio: 20, kneeDb: 0, attackSec: 0.001, releaseSec: 0.1 };
/** Track/master gain range of the project format (linear). */
export const GAIN_MAX = 1.5;
/** Time constant for live parameter changes. */
export const PARAM_SMOOTHING_SEC = 0.02;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export interface ResolvedFx {
  lowDb: number;
  midDb: number;
  highDb: number;
  compEnabled: boolean;
  compThresholdDb: number;
  compRatio: number;
  /** 0–1. */
  reverbSend: number;
}

/** Clamp a (possibly hand-edited) TrackFx into the ranges the nodes accept. */
export function resolveFx(fx: TrackFx | undefined): ResolvedFx {
  const f = fx ?? DEFAULT_FX;
  return {
    lowDb: clamp(f.eq.low, EQ_MIN_DB, EQ_MAX_DB),
    midDb: clamp(f.eq.mid, EQ_MIN_DB, EQ_MAX_DB),
    highDb: clamp(f.eq.high, EQ_MIN_DB, EQ_MAX_DB),
    compEnabled: f.comp.enabled,
    compThresholdDb: clamp(f.comp.thresholdDb, COMP_THRESHOLD_MIN_DB, COMP_THRESHOLD_MAX_DB),
    compRatio: clamp(f.comp.ratio, COMP_RATIO_MIN, COMP_RATIO_MAX),
    reverbSend: clamp(f.reverbSend, 0, 1),
  };
}

/** Gains of the parallel compressor paths: dry 1 / wet 0 when bypassed. */
export function compMix(enabled: boolean): { dry: number; wet: number } {
  return enabled ? { dry: 0, wet: 1 } : { dry: 1, wet: 0 };
}

/**
 * Fader law: position 0…1 → linear gain 0…GAIN_MAX, gain = GAIN_MAX·pos².
 * Unity sits at ≈0.816, −6 dB at ≈0.577, −20 dB at ≈0.258.
 */
export function faderPosToGain(pos: number): number {
  const p = clamp(pos, 0, 1);
  return GAIN_MAX * p * p;
}

export function gainToFaderPos(gain: number): number {
  return Math.sqrt(clamp(gain, 0, GAIN_MAX) / GAIN_MAX);
}

/** Linear gain → dB for display ('-∞' for 0). */
export function formatDb(gain: number): string {
  if (!(gain > 0)) return '-∞';
  const db = 20 * Math.log10(gain);
  return `${db > 0.05 ? '+' : ''}${db.toFixed(1)}`;
}

/** Equal-power-ish pan label: L50 / C / R30. */
export function formatPan(pan: number): string {
  const v = Math.round(clamp(pan, -1, 1) * 100);
  if (v === 0) return 'C';
  return v < 0 ? `L${-v}` : `R${v}`;
}

/** Mute/solo gate value for a track. */
export function audibleGain(muted: boolean, solo: boolean, anySolo: boolean): number {
  return (anySolo ? solo : !muted) ? 1 : 0;
}

/** Deterministic PRNG (mulberry32) so impulse responses are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A stereo room impulse response: decorrelated noise under an exponential
 * envelope reaching −60 dB at `decaySec`, a short pre-delay, and a gentle
 * one-pole low-pass whose cutoff falls over time (air absorption).
 */
export function generateImpulse(
  sampleRate: number,
  decaySec = REVERB_DECAY_SEC,
  seed = 0x51a7,
): [Float32Array, Float32Array] {
  const length = Math.max(1, Math.ceil(sampleRate * decaySec));
  const preDelay = Math.floor(sampleRate * 0.012);
  const channels: [Float32Array, Float32Array] = [
    new Float32Array(length),
    new Float32Array(length),
  ];
  const k = Math.log(1000) / decaySec; // amplitude e^(−k t) = −60 dB at decaySec
  channels.forEach((data, ch) => {
    const rand = mulberry32(seed + ch * 7919);
    let lp = 0;
    for (let i = preDelay; i < length; i++) {
      const t = (i - preDelay) / sampleRate;
      const noise = rand() * 2 - 1;
      const damp = 0.15 + 0.8 * Math.exp(-t * 2.5); // brighter early, darker late
      lp += damp * (noise - lp);
      data[i] = lp * Math.exp(-k * t);
    }
  });
  return channels;
}

// ── node graph (needs a BaseAudioContext) ────────────────────────────────────

export interface TrackStrip {
  input: GainNode;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  dry: GainNode;
  comp: DynamicsCompressorNode;
  wet: GainNode;
  /** The track fader. */
  gain: GainNode;
  /** Mute/solo gate. */
  mute: GainNode;
  pan: StereoPannerNode;
  send: GainNode;
  analyser: AnalyserNode;
  /** Disconnect everything (sources feeding `input` go silent). */
  dispose: () => void;
}

export interface StripParams {
  fx: ResolvedFx;
  gain: number;
  pan: number;
  audible: number;
}

function setParam(param: AudioParam, value: number, time: number | null): void {
  if (time === null) param.value = value;
  else param.setTargetAtTime(value, time, PARAM_SMOOTHING_SEC);
}

export function buildTrackStrip(
  ctx: BaseAudioContext,
  masterBus: AudioNode,
  reverbBus: AudioNode,
  params: StripParams,
): TrackStrip {
  const input = ctx.createGain();
  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = EQ_LOW_HZ;
  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = EQ_MID_HZ;
  mid.Q.value = EQ_MID_Q;
  const high = ctx.createBiquadFilter();
  high.type = 'highshelf';
  high.frequency.value = EQ_HIGH_HZ;
  const dry = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.knee.value = 6;
  comp.attack.value = 0.01;
  comp.release.value = 0.2;
  const wet = ctx.createGain();
  const gain = ctx.createGain();
  const mute = ctx.createGain();
  const pan = ctx.createStereoPanner();
  const send = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;

  input.connect(low).connect(mid).connect(high);
  high.connect(dry).connect(gain);
  high.connect(comp).connect(wet).connect(gain);
  gain.connect(mute).connect(pan);
  pan.connect(analyser).connect(masterBus);
  pan.connect(send).connect(reverbBus);

  const strip: TrackStrip = {
    input,
    low,
    mid,
    high,
    dry,
    comp,
    wet,
    gain,
    mute,
    pan,
    send,
    analyser,
    dispose: () => {
      for (const node of [input, low, mid, high, dry, comp, wet, gain, mute, pan, send, analyser]) {
        node.disconnect();
      }
    },
  };
  applyStripParams(strip, params, null);
  return strip;
}

/** Update a strip; `time` = ctx.currentTime for smoothed live changes, null to set instantly. */
export function applyStripParams(
  strip: TrackStrip,
  params: StripParams,
  time: number | null,
): void {
  const { fx } = params;
  setParam(strip.low.gain, fx.lowDb, time);
  setParam(strip.mid.gain, fx.midDb, time);
  setParam(strip.high.gain, fx.highDb, time);
  setParam(strip.comp.threshold, fx.compThresholdDb, time);
  setParam(strip.comp.ratio, fx.compRatio, time);
  const mix = compMix(fx.compEnabled);
  setParam(strip.dry.gain, mix.dry, time);
  setParam(strip.wet.gain, mix.wet, time);
  setParam(strip.send.gain, fx.reverbSend, time);
  setParam(strip.gain.gain, clamp(params.gain, 0, GAIN_MAX), time);
  setParam(strip.mute.gain, params.audible, time);
  setParam(strip.pan.pan, clamp(params.pan, -1, 1), time);
}

export interface MasterSection {
  /** Master bus: tracks, the reverb return and the metronome connect here. */
  bus: GainNode;
  limiter: DynamicsCompressorNode;
  analyser: AnalyserNode;
  /** Shared reverb send bus (track sends connect here). */
  reverbIn: GainNode;
  convolver: ConvolverNode;
  dispose: () => void;
}

const impulseCache = new Map<number, [Float32Array, Float32Array]>();

export function buildMasterSection(
  ctx: BaseAudioContext,
  destination: AudioNode,
  masterGain: number,
): MasterSection {
  const bus = ctx.createGain();
  bus.gain.value = clamp(masterGain, 0, GAIN_MAX);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = LIMITER.thresholdDb;
  limiter.ratio.value = LIMITER.ratio;
  limiter.knee.value = LIMITER.kneeDb;
  limiter.attack.value = LIMITER.attackSec;
  limiter.release.value = LIMITER.releaseSec;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  bus.connect(limiter).connect(analyser).connect(destination);

  const reverbIn = ctx.createGain();
  const convolver = ctx.createConvolver();
  let ir = impulseCache.get(ctx.sampleRate);
  if (!ir) {
    ir = generateImpulse(ctx.sampleRate);
    impulseCache.set(ctx.sampleRate, ir);
  }
  const irBuffer = ctx.createBuffer(2, ir[0].length, ctx.sampleRate);
  irBuffer.getChannelData(0).set(ir[0]);
  irBuffer.getChannelData(1).set(ir[1]);
  convolver.buffer = irBuffer;
  const ret = ctx.createGain();
  ret.gain.value = 0.8;
  reverbIn.connect(convolver).connect(ret).connect(bus);

  return {
    bus,
    limiter,
    analyser,
    reverbIn,
    convolver,
    dispose: () => {
      for (const node of [bus, limiter, analyser, reverbIn, convolver, ret]) node.disconnect();
    },
  };
}
