/**
 * The studio audio engine (Stage 5 Tier 1).
 *
 * STRICTLY separated from React: the UI edits the plain-data project and
 * talks to this class via methods/subscriptions only; no audio calls happen
 * in UI handlers except `unlock()` on the first user gesture. A 25 ms
 * lookahead scheduler with a 150 ms horizon walks the project's regions, so
 * UI jank never drops notes.
 *
 * Voices:
 *  • oud — the shared Karplus-Strong Beerdilaacshe voice (lib/audio/
 *    qaraamiEngine), plucks rendered once per (midi, duration bucket) into
 *    cached AudioBuffers;
 *  • durbaan — dum/tak strokes from the same module + a slap stroke;
 *  • bass/keys — original subtractive voices (osc → filter → ADSR).
 *
 * Studio v2 adds audio tracks (decoded, cached AudioBuffers scheduled per
 * region pass — see audioSchedule.ts), per-track insert FX + a shared reverb
 * and a master limiter (fx.ts), metering, and recording (AudioWorklet capture
 * → WAV in the IndexedDB audio store, latency-compensated).
 *
 * The same scheduling code renders WAV mixdowns and stems through an
 * OfflineAudioContext with the same FX graph — what you hear is what exports.
 */

import { ENGINE_SAMPLE_RATE, dum, normalize, pluck, tak } from '@/lib/audio/qaraamiEngine';
import {
  type ClipStart,
  type TransportSpan,
  clipEnvelope,
  bucketPeaks as bucketPeaksOf,
  clipsInWindow,
  levelsOf,
  METER_FLOOR_DB,
  recordingTrimFrames,
  regionSegments,
  transportSpans,
} from './audioSchedule';
import { getAudio, isIdbSource, putAudio } from './audioStore';
import {
  type MasterSection,
  type StripParams,
  type TrackStrip,
  applyStripParams,
  audibleGain,
  buildMasterSection,
  buildTrackStrip,
  REVERB_DECAY_SEC,
  resolveFx,
} from './fx';
import type { DawProject, DawTrack, InstrumentId } from './types';
import { audioRegionsOf, projectEndBeat, trackKind } from './types';
import { audioBufferToWav } from './wav';

export type TransportState = 'stopped' | 'counting' | 'playing';

export interface EngineSnapshot {
  state: TransportState;
  /** Transport position in beats (folded into the loop when looping). */
  beat: number;
}

type Listener = (snapshot: EngineSnapshot) => void;

const LOOKAHEAD_MS = 25;
const HORIZON_SEC = 0.15;

// ── Cached percussive/pluck sample rendering ─────────────────────────────────

const pluckCache = new Map<string, AudioBuffer>();
const strokeCache = new Map<string, AudioBuffer>();

function renderPluckBuffer(ctx: BaseAudioContext, midi: number, seconds: number): AudioBuffer {
  const key = `${midi}:${seconds.toFixed(2)}`;
  const cached = pluckCache.get(key);
  if (cached) return cached;
  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  const out = new Float32Array(Math.ceil((seconds + 0.05) * ENGINE_SAMPLE_RATE));
  // The Beerdilaacshe oud voice: doubled course ±5 cents + faint low octave.
  pluck(out, 0, freq * Math.pow(2, -5 / 1200), seconds, 0.5, midi * 2654435761);
  pluck(out, 0.006, freq * Math.pow(2, 5 / 1200), seconds, 0.4, midi * 40503 + 7);
  pluck(out, 0.003, freq / 2, seconds * 0.8, 0.08, midi * 69069 + 13);
  const buffer = ctx.createBuffer(1, out.length, ENGINE_SAMPLE_RATE);
  buffer.getChannelData(0).set(out);
  pluckCache.set(key, buffer);
  return buffer;
}

function renderStrokeBuffer(ctx: BaseAudioContext, stroke: 'dum' | 'tak' | 'slap'): AudioBuffer {
  const cached = strokeCache.get(stroke);
  if (cached) return cached;
  const out = new Float32Array(Math.ceil(0.3 * ENGINE_SAMPLE_RATE));
  if (stroke === 'dum') dum(out, 0, 0.9);
  if (stroke === 'tak') tak(out, 0, 0.7);
  if (stroke === 'slap') {
    // Slap: a mid ring between dum and tak — short 190 Hz body + bright snap.
    dum(out, 0, 0.35);
    tak(out, 0, 0.5);
    for (let i = 0; i < out.length; i++) {
      const t = i / ENGINE_SAMPLE_RATE;
      out[i] = (out[i] ?? 0) + Math.sin(2 * Math.PI * 190 * t) * 0.4 * Math.exp(-t * 60);
    }
  }
  normalize(out, 0.9);
  const buffer = ctx.createBuffer(1, out.length, ENGINE_SAMPLE_RATE);
  buffer.getChannelData(0).set(out);
  strokeCache.set(stroke, buffer);
  return buffer;
}

function strokeForMidi(midi: number): 'dum' | 'tak' | 'slap' {
  if (midi <= 36) return 'dum';
  if (midi >= 42) return 'slap';
  return 'tak';
}

// ── Note events ─────────────────────────────────────────────────────────────

interface ScheduledNote {
  trackId: string;
  instrument: InstrumentId;
  midi: number;
  velocity: number;
  /** Absolute transport time, in seconds from play start (unfolded). */
  timeSec: number;
  durationSec: number;
}

/** Flatten a project into absolute-beat events once per play/edit (cheap). */
function flattenNotes(
  project: DawProject,
  audible: (track: DawTrack) => boolean = (track) => trackAudible(project, track),
): ScheduledNote[] {
  const secPerBeat = 60 / project.bpm;
  const events: ScheduledNote[] = [];
  for (const track of project.tracks) {
    if (trackKind(track) !== 'midi' || !audible(track)) continue;
    for (const region of track.regions) {
      for (let pass = 0; pass < region.loopCount; pass++) {
        const passStart = region.startBeat + pass * region.lengthBeats;
        for (const note of region.notes) {
          if (note.startBeat >= region.lengthBeats) continue;
          events.push({
            trackId: track.id,
            instrument: track.instrument,
            midi: note.midi,
            velocity: note.velocity,
            timeSec: (passStart + note.startBeat) * secPerBeat,
            durationSec: Math.max(0.05, note.lengthBeats * secPerBeat),
          });
        }
      }
    }
  }
  return events.sort((a, b) => a.timeSec - b.timeSec);
}

// ── Voice scheduling (shared by live playback and offline export) ────────────

function scheduleVoice(
  ctx: BaseAudioContext,
  destination: AudioNode,
  event: { instrument: InstrumentId; midi: number; velocity: number; durationSec: number },
  when: number,
): void {
  const velocityGain = 0.25 + 0.75 * event.velocity;
  if (event.instrument === 'oud') {
    const seconds = Math.min(2.5, Math.max(0.5, event.durationSec + 0.35));
    const bucket = Math.ceil(seconds * 4) / 4;
    const src = ctx.createBufferSource();
    src.buffer = renderPluckBuffer(ctx, event.midi, bucket);
    const g = ctx.createGain();
    g.gain.value = velocityGain;
    src.connect(g).connect(destination);
    src.start(when);
    return;
  }
  if (event.instrument === 'durbaan') {
    const src = ctx.createBufferSource();
    src.buffer = renderStrokeBuffer(ctx, strokeForMidi(event.midi));
    const g = ctx.createGain();
    g.gain.value = velocityGain;
    src.connect(g).connect(destination);
    src.start(when);
    return;
  }
  // bass / keys — subtractive synth voices.
  const isBass = event.instrument === 'bass';
  const freq = 440 * Math.pow(2, (event.midi - 69) / 12);
  const attack = isBass ? 0.008 : 0.012;
  const release = isBass ? 0.08 : 0.18;
  const hold = Math.max(0.05, event.durationSec);
  const end = when + hold + release;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = isBass ? Math.min(1200, freq * 6) : Math.min(6000, freq * 8);
  filter.Q.value = isBass ? 6 : 1.5;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(velocityGain * (isBass ? 0.5 : 0.24), when + attack);
  env.gain.setValueAtTime(velocityGain * (isBass ? 0.5 : 0.24), when + hold);
  env.gain.linearRampToValueAtTime(0.0001, end);

  const oscs: OscillatorNode[] = [];
  const osc1 = ctx.createOscillator();
  osc1.type = isBass ? 'sawtooth' : 'triangle';
  osc1.frequency.value = isBass ? freq / 2 : freq;
  oscs.push(osc1);
  if (!isBass) {
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2;
    osc2.detune.value = 6;
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    osc2.connect(g2).connect(filter);
    oscs.push(osc2);
  }
  osc1.connect(filter);
  filter.connect(env).connect(destination);
  for (const osc of oscs) {
    osc.start(when);
    osc.stop(end + 0.02);
  }
}

function scheduleClick(
  ctx: BaseAudioContext,
  destination: AudioNode,
  when: number,
  accented: boolean,
): void {
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = accented ? 1568 : 1046;
  const g = ctx.createGain();
  g.gain.setValueAtTime(accented ? 0.24 : 0.15, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
  osc.connect(g).connect(destination);
  osc.start(when);
  osc.stop(when + 0.06);
}

// ── Audio clips (shared by live playback and offline export) ─────────────────

/** Start one audio clip into `destination` at context time `when`. */
function startClip(
  ctx: BaseAudioContext,
  destination: AudioNode,
  buffer: AudioBuffer,
  clip: ClipStart,
  when: number,
): { source: AudioBufferSourceNode; env: GainNode } {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const env = ctx.createGain();
  const points = clipEnvelope(clip);
  const start = Math.max(when, ctx.currentTime);
  const late = start - when;
  env.gain.setValueAtTime(points[0]?.value ?? 0, start);
  for (const point of points.slice(1)) {
    env.gain.linearRampToValueAtTime(point.value, Math.max(start, when + point.t));
  }
  source.connect(env).connect(destination);
  const duration = clip.durationSec - late;
  if (duration > 0) {
    source.start(start, clip.segment.fileOffsetSec + clip.segmentOffsetSec + late, duration);
  }
  return { source, env };
}

const OPEN_SPAN: TransportSpan[] = [{ unfoldedStart: 0, timelineStart: 0, timelineEnd: Infinity }];

// ── Recording capture (AudioWorklet, loaded from an inline module) ───────────

const CAPTURE_PROCESSOR = 'qaraami-capture';
const CAPTURE_BLOCK = 4096;
const CAPTURE_WORKLET_SOURCE = `
class QaraamiCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = true;
    this.buf = new Float32Array(${CAPTURE_BLOCK});
    this.fill = 0;
    this.blockTime = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') {
        this.flush();
        this.port.postMessage({ type: 'done' });
        this.active = false;
      }
    };
  }
  flush() {
    if (this.fill === 0) return;
    const samples = this.buf.slice(0, this.fill);
    this.port.postMessage({ type: 'block', time: this.blockTime, samples }, [samples.buffer]);
    this.fill = 0;
  }
  process(inputs) {
    if (!this.active) return false;
    const input = inputs[0];
    const ch = input && input[0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        if (this.fill === 0) this.blockTime = (currentFrame + i) / sampleRate;
        this.buf[this.fill++] = ch[i];
        if (this.fill === this.buf.length) this.flush();
      }
    }
    return true;
  }
}
registerProcessor('${CAPTURE_PROCESSOR}', QaraamiCapture);
`;

type CaptureMessage = { type: 'block'; time: number; samples: Float32Array } | { type: 'done' };

function isCaptureMessage(data: unknown): data is CaptureMessage {
  if (typeof data !== 'object' || data === null || !('type' in data)) return false;
  if (data.type === 'done') return true;
  return (
    data.type === 'block' &&
    'time' in data &&
    typeof data.time === 'number' &&
    'samples' in data &&
    data.samples instanceof Float32Array
  );
}

interface ActiveRecording {
  trackId: string;
  stream: MediaStream;
  input: MediaStreamAudioSourceNode;
  worklet: AudioWorkletNode;
  sink: GainNode;
  monitor: GainNode;
  blocks: Float32Array[];
  captureStartTime: number | null;
  sampleRate: number;
  startBeat: number;
  epoch: number;
  compensationSec: number;
  done: Promise<void>;
  finishing: Promise<RecordedTake> | null;
}

/** A finished recording, already stored in the audio store. */
export interface RecordedTake {
  trackId: string;
  /** 'idb:<id>' — use as DawAudioRegion.source. */
  source: string;
  name: string;
  durationSec: number;
  /** Timeline beat where the take starts (latency-compensated). */
  startBeat: number;
}

export interface LevelReading {
  peakDb: number;
  rmsDb: number;
}

export interface EngineLevels {
  master: LevelReading;
  tracks: Record<string, LevelReading>;
}

const SILENT: LevelReading = { peakDb: METER_FLOOR_DB, rmsDb: METER_FLOOR_DB };

/** Resolve a non-IDB source as a same-origin URL (never fetch other hosts). */
function sameOriginUrl(source: string): string {
  const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost/';
  const url = new URL(source, base);
  if (typeof window !== 'undefined' && url.origin !== window.location.origin) {
    throw new Error(`Audio source must be same-origin: ${source}`);
  }
  return url.toString();
}

async function fetchAudioBytes(source: string): Promise<ArrayBuffer> {
  if (isIdbSource(source)) {
    const blob = await getAudio(source);
    if (!blob) throw new Error(`Audio not found in this browser: ${source}`);
    return blob.arrayBuffer();
  }
  const response = await fetch(sameOriginUrl(source));
  if (!response.ok) throw new Error(`Audio fetch failed (${response.status}): ${source}`);
  return response.arrayBuffer();
}

function stripParamsFor(project: DawProject, track: DawTrack, forceAudible = false): StripParams {
  const anySolo = project.tracks.some((t) => t.solo);
  return {
    fx: resolveFx(track.fx),
    gain: track.gain,
    pan: track.pan,
    audible: forceAudible ? 1 : audibleGain(track.muted, track.solo, anySolo),
  };
}

function audioSignature(project: DawProject): string {
  return JSON.stringify([
    project.bpm,
    project.tracks.filter((t) => trackKind(t) === 'audio').map((t) => [t.id, audioRegionsOf(t)]),
  ]);
}

// ── The engine ───────────────────────────────────────────────────────────────

export class DawEngine {
  private ctx: AudioContext | null = null;
  private masterSection: MasterSection | null = null;
  private strips = new Map<string, TrackStrip>();
  private project: DawProject | null = null;
  private events: ScheduledNote[] = [];
  private state: TransportState = 'stopped';
  private timer: number | null = null;
  private listeners = new Set<Listener>();
  /** ctx.currentTime at unfolded transport second 0 (i.e. at playStartBeat). */
  private epoch = 0;
  private playStartBeat = 0;
  private scheduledUntil = 0;
  private countInUntil = 0;

  // audio regions
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer>>();
  private failed = new Set<string>();
  private peaks = new Map<string, Float32Array>();
  private decodeCtx: OfflineAudioContext | null = null;
  private liveClips = new Map<AudioBufferSourceNode, GainNode>();
  private audioSig = '';
  private resyncTimer: number | null = null;
  private audioListeners = new Set<(source: string) => void>();

  // recording + metering
  private rec: ActiveRecording | null = null;
  private recordingListeners = new Set<(take: RecordedTake) => void>();
  private captureModuleCtx: AudioContext | null = null;
  private monitoring = false;
  private scratch = new Map<number, Float32Array<ArrayBuffer>>();

  private get master(): GainNode | null {
    return this.masterSection?.bus ?? null;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  /** Create/resume the AudioContext. MUST be called from a user gesture once. */
  unlock(): void {
    if (this.ctx === null) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.masterSection = buildMasterSection(
        this.ctx,
        this.ctx.destination,
        this.project?.masterGain ?? 1,
      );
      if (this.project) this.rebuildChains();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  dispose(): void {
    this.discardRecording();
    this.stop();
    this.listeners.clear();
    this.audioListeners.clear();
    this.recordingListeners.clear();
    if (this.resyncTimer !== null) window.clearTimeout(this.resyncTimer);
    const ctx = this.ctx;
    this.ctx = null;
    for (const strip of this.strips.values()) strip.dispose();
    this.strips.clear();
    this.masterSection?.dispose();
    this.masterSection = null;
    if (ctx && ctx.state !== 'closed') void ctx.close();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot: EngineSnapshot = { state: this.state, beat: this.currentBeat() };
    for (const listener of this.listeners) listener(snapshot);
  }

  // ── project + mix ──────────────────────────────────────────────────────────

  setProject(project: DawProject): void {
    const structureChanged =
      this.project === null ||
      this.project.tracks.length !== project.tracks.length ||
      this.project.tracks.some((t, i) => t.id !== project.tracks[i]?.id);
    this.project = project;
    if (this.ctx && structureChanged) this.rebuildChains();
    if (this.ctx) this.applyMix();
    // Re-flatten so edits during playback are heard from the horizon onwards.
    this.events = flattenNotes(project);
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(project.masterGain, this.ctx.currentTime, 0.02);
    }
    // Prefetch audio so play() rarely waits on a decode.
    for (const track of project.tracks) {
      if (trackKind(track) !== 'audio') continue;
      for (const region of audioRegionsOf(track)) this.requestLoad(region.source);
    }
    // Audio clips are long-lived sources: re-cut them when their regions change.
    // A structural rebuild cut the live clips with the old strips: restart now.
    const sig = audioSignature(project);
    if (structureChanged) {
      this.audioSig = sig;
      this.resyncAudio();
    } else if (sig !== this.audioSig) {
      this.audioSig = sig;
      this.scheduleResync();
    }
  }

  private rebuildChains(): void {
    const ctx = this.ctx;
    const section = this.masterSection;
    const project = this.project;
    if (!ctx || !section || !project) return;
    for (const strip of this.strips.values()) strip.dispose();
    this.strips.clear();
    for (const track of project.tracks) {
      this.strips.set(
        track.id,
        buildTrackStrip(ctx, section.bus, section.reverbIn, stripParamsFor(project, track)),
      );
    }
  }

  private applyMix(): void {
    const ctx = this.ctx;
    const project = this.project;
    if (!ctx || !project) return;
    for (const track of project.tracks) {
      const strip = this.strips.get(track.id);
      if (strip) applyStripParams(strip, stripParamsFor(project, track), ctx.currentTime);
    }
  }

  /** Post-pan analyser of a track (kept for older meters; prefer getLevels()). */
  getAnalyser(trackId: string): AnalyserNode | null {
    return this.strips.get(trackId)?.analyser ?? null;
  }

  /** Post-fader peak/RMS (dBFS) per track and post-limiter for the master. */
  getLevels(): EngineLevels {
    const tracks: Record<string, LevelReading> = {};
    for (const [id, strip] of this.strips) tracks[id] = this.read(strip.analyser);
    return {
      master: this.masterSection ? this.read(this.masterSection.analyser) : SILENT,
      tracks,
    };
  }

  private read(analyser: AnalyserNode): LevelReading {
    let block = this.scratch.get(analyser.fftSize);
    if (!block) {
      block = new Float32Array(analyser.fftSize);
      this.scratch.set(analyser.fftSize, block);
    }
    analyser.getFloatTimeDomainData(block);
    return levelsOf(block);
  }

  // ── audio sources ──────────────────────────────────────────────────────────

  /** Decode (and cache) an audio source: 'idb:<id>' or a same-origin URL. */
  async loadAudio(source: string): Promise<{ durationSec: number }> {
    this.failed.delete(source);
    const buffer = await this.decode(source);
    return { durationSec: buffer.duration };
  }

  /** The decoded buffer for a source, if loaded (for custom rendering). */
  getAudioBuffer(source: string): AudioBuffer | null {
    return this.buffers.get(source) ?? null;
  }

  /**
   * Waveform overview: absolute peak (0…1, max over channels) per bucket,
   * `buckets` long, cached. Null until the source is decoded (a load is
   * started; subscribeAudio() reports when it lands).
   */
  getPeaks(source: string, buckets: number): Float32Array | null {
    const buffer = this.buffers.get(source);
    if (!buffer) {
      this.requestLoad(source);
      return null;
    }
    const n = Math.max(1, Math.min(100000, Math.floor(buckets)));
    const key = `${n}|${source}`;
    const cached = this.peaks.get(key);
    if (cached) return cached;
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch));
    const result = bucketPeaksOf(channels, n);
    if (this.peaks.size > 256) this.peaks.clear();
    this.peaks.set(key, result);
    return result;
  }

  /** Called with the source each time an audio source finishes decoding. */
  subscribeAudio(listener: (source: string) => void): () => void {
    this.audioListeners.add(listener);
    return () => this.audioListeners.delete(listener);
  }

  private decode(source: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(source);
    if (cached) return Promise.resolve(cached);
    const pending = this.loading.get(source);
    if (pending) return pending;
    const promise = (async () => {
      const bytes = await fetchAudioBytes(source);
      const ctx: BaseAudioContext =
        this.ctx ?? (this.decodeCtx ??= new OfflineAudioContext(2, 1, 48000));
      const buffer = await ctx.decodeAudioData(bytes);
      this.buffers.set(source, buffer);
      return buffer;
    })();
    this.loading.set(source, promise);
    promise.then(
      () => {
        this.loading.delete(source);
        for (const listener of this.audioListeners) listener(source);
        if (this.state !== 'stopped') this.scheduleResync();
      },
      () => {
        this.loading.delete(source);
        this.failed.add(source);
      },
    );
    return promise;
  }

  private requestLoad(source: string): void {
    if (this.buffers.has(source) || this.loading.has(source) || this.failed.has(source)) return;
    this.decode(source).catch(() => undefined);
  }

  // ── transport ──────────────────────────────────────────────────────────────

  private secPerBeat(): number {
    return 60 / (this.project?.bpm ?? 120);
  }

  /** Folded transport beat for the UI playhead. */
  currentBeat(): number {
    if (!this.ctx || !this.project || this.state === 'stopped') return this.playStartBeat;
    const unfoldedSec = this.ctx.currentTime - this.epoch;
    if (unfoldedSec < 0) return this.playStartBeat; // counting in
    return this.foldBeat(this.playStartBeat + unfoldedSec / this.secPerBeat());
  }

  private foldBeat(beat: number): number {
    const project = this.project;
    if (!project || !project.loop.enabled) return beat;
    const { startBeat, endBeat } = project.loop;
    const span = endBeat - startBeat;
    if (span <= 0 || beat < endBeat) return beat;
    return startBeat + ((beat - startBeat) % span);
  }

  play(fromBeat = 0): void {
    if (!this.project) return;
    this.unlock();
    const ctx = this.ctx;
    if (!ctx) return;
    this.stopScheduler();
    this.stopSources();

    const project = this.project;
    const countInBeats =
      project.metronome.enabled && project.metronome.countInBars > 0
        ? project.metronome.countInBars * project.timeSignature.beatsPerBar
        : 0;
    const startAt = ctx.currentTime + 0.08;
    this.playStartBeat = project.loop.enabled
      ? Math.max(project.loop.startBeat, Math.min(fromBeat, project.loop.endBeat))
      : fromBeat;
    this.epoch = startAt + countInBeats * this.secPerBeat();
    this.countInUntil = this.epoch;
    this.scheduledUntil = ctx.currentTime;
    this.state = countInBeats > 0 ? 'counting' : 'playing';

    // Count-in clicks are scheduled up front (they are few).
    if (countInBeats > 0 && this.master) {
      for (let i = 0; i < countInBeats; i++) {
        scheduleClick(
          ctx,
          this.master,
          startAt + i * this.secPerBeat(),
          i % project.timeSignature.beatsPerBar === 0,
        );
      }
    }

    this.timer = window.setInterval(() => this.schedulerTick(), LOOKAHEAD_MS);
    this.schedulerTick();
    this.emit();
  }

  stop(): void {
    if (this.rec && !this.rec.finishing) void this.stopRecording().catch(() => undefined);
    this.stopScheduler();
    this.stopSources();
    this.state = 'stopped';
    this.emit();
  }

  /** Move the transport. While playing this restarts from the target beat;
   * while stopped it just parks the playhead there for the next play. */
  seek(beat: number): void {
    const target = Math.max(0, beat);
    if (this.state === 'stopped') {
      this.playStartBeat = target;
      this.emit();
      return;
    }
    this.play(target);
  }

  /** Park the playhead at zero (stop is position-preserving). */
  returnToStart(): void {
    this.seek(0);
  }

  private stopScheduler(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Synth voices cannot be tracked cheaply; a hard stop rebuilds the track
   * strips (orphaning their voices). Audio clips are tracked and faded. */
  private stopSources(): void {
    if (!this.ctx) return;
    this.stopClips(0.004);
    this.rebuildChains();
  }

  private stopClips(fadeSec: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [source, env] of this.liveClips) {
      env.gain.cancelScheduledValues(now);
      env.gain.setTargetAtTime(0, now, fadeSec);
      try {
        source.stop(now + fadeSec * 6);
      } catch {
        // never started (zero-length) — nothing to stop
      }
    }
    this.liveClips.clear();
  }

  /** Coalesce audio re-cuts (drags fire many edits per second). */
  private scheduleResync(): void {
    if (this.state === 'stopped' || this.resyncTimer !== null) return;
    this.resyncTimer = window.setTimeout(() => {
      this.resyncTimer = null;
      this.resyncAudio();
    }, 60);
  }

  /** Fade out every live clip and restart audio from just ahead of now. */
  private resyncAudio(): void {
    const ctx = this.ctx;
    if (!ctx || this.state === 'stopped') return;
    this.stopClips(0.006);
    const from = ctx.currentTime + 0.03 - this.epoch;
    const to = this.scheduledUntil - this.epoch;
    if (to > from) this.scheduleAudio(ctx, from, to, true);
  }

  private loopSeconds(): { startSec: number; endSec: number } | null {
    const project = this.project;
    if (!project || !project.loop.enabled) return null;
    const spb = this.secPerBeat();
    return { startSec: project.loop.startBeat * spb, endSec: project.loop.endBeat * spb };
  }

  private scheduleAudio(
    ctx: AudioContext,
    fromUnfolded: number,
    toUnfolded: number,
    includeSounding: boolean,
  ): void {
    const project = this.project;
    if (!project) return;
    const spb = this.secPerBeat();
    const spans = transportSpans(
      this.playStartBeat * spb,
      this.loopSeconds(),
      fromUnfolded,
      toUnfolded,
    );
    for (const track of project.tracks) {
      if (trackKind(track) !== 'audio') continue;
      const strip = this.strips.get(track.id);
      if (!strip) continue;
      for (const region of audioRegionsOf(track)) {
        const buffer = this.buffers.get(region.source);
        if (!buffer) {
          this.requestLoad(region.source);
          continue;
        }
        const segments = regionSegments(region, spb, buffer.duration);
        for (const clip of clipsInWindow(
          segments,
          spans,
          fromUnfolded,
          toUnfolded,
          includeSounding,
        )) {
          const { source, env } = startClip(
            ctx,
            strip.input,
            buffer,
            clip,
            this.epoch + clip.unfoldedStart,
          );
          this.liveClips.set(source, env);
          source.onended = () => {
            if (this.liveClips.get(source) === env) this.liveClips.delete(source);
            env.disconnect();
          };
        }
      }
    }
  }

  private schedulerTick(): void {
    const ctx = this.ctx;
    const project = this.project;
    if (!ctx || !project || this.state === 'stopped') return;

    if (this.state === 'counting' && ctx.currentTime >= this.countInUntil) {
      this.state = 'playing';
    }

    const horizonEnd = ctx.currentTime + HORIZON_SEC;
    const from = Math.max(this.scheduledUntil, this.epoch - 0.001);
    if (horizonEnd <= from) {
      this.emit();
      return;
    }

    const secPerBeat = this.secPerBeat();
    const loop = project.loop;
    const playStartAbs = this.playStartBeat * secPerBeat;
    const loopStartAbs = loop.startBeat * secPerBeat;
    const loopEndAbs = loop.endBeat * secPerBeat;
    const spanSec = loopEndAbs - loopStartAbs;
    const looping = loop.enabled && spanSec > 1e-4;
    const endSec = projectEndBeat(project) * secPerBeat - playStartAbs;

    // Unfolded transport seconds covered by this tick's window.
    const windowStartUnfolded = from - this.epoch;
    const windowEndUnfolded = horizonEnd - this.epoch;

    // For each event, compute its unfolded occurrence(s) in the window.
    // Absolute-time math so starting INSIDE the loop range still wraps
    // earlier-in-the-loop notes correctly on later passes.
    for (const event of this.events) {
      const occurrences: number[] = [];
      if (!looping) {
        occurrences.push(event.timeSec - playStartAbs);
      } else if (event.timeSec < loopStartAbs) {
        occurrences.push(event.timeSec - playStartAbs); // once, on the way in
      } else if (event.timeSec < loopEndAbs) {
        const base = event.timeSec - playStartAbs; // pass 0 (may be negative)
        const firstPass = Math.max(0, Math.ceil((windowStartUnfolded - base) / spanSec - 1e-6));
        for (let pass = firstPass; pass < firstPass + 2; pass++) {
          const occurrence = base + pass * spanSec;
          if (occurrence >= -1e-4) occurrences.push(occurrence);
        }
      }
      for (const unfolded of occurrences) {
        if (unfolded < windowStartUnfolded - 1e-4 || unfolded >= windowEndUnfolded) continue;
        const strip = this.strips.get(event.trackId);
        if (strip) scheduleVoice(ctx, strip.input, event, this.epoch + unfolded);
      }
    }

    // Audio regions: sources that start inside this window.
    this.scheduleAudio(ctx, windowStartUnfolded, windowEndUnfolded, false);

    // Metronome during playback.
    if (project.metronome.enabled && this.master) {
      const beatsPerBar = project.timeSignature.beatsPerBar;
      const firstBeat = Math.ceil(windowStartUnfolded / secPerBeat + this.playStartBeat - 1e-4);
      const lastBeat = Math.floor(windowEndUnfolded / secPerBeat + this.playStartBeat);
      for (let b = firstBeat; b <= lastBeat; b++) {
        const unfolded = (b - this.playStartBeat) * secPerBeat;
        if (unfolded < windowStartUnfolded - 1e-4 || unfolded >= windowEndUnfolded) continue;
        const folded = this.foldBeat(b);
        scheduleClick(ctx, this.master, this.epoch + unfolded, folded % beatsPerBar === 0);
      }
    }

    this.scheduledUntil = horizonEnd;

    // Auto-stop past the end of the arrangement (unless looping or recording).
    if (!loop.enabled && !this.rec && windowStartUnfolded > endSec + 1.5) {
      this.stop();
      return;
    }
    this.emit();
  }

  /** Piano-roll/pad preview — immediate, outside the transport. */
  audition(instrument: InstrumentId, midi: number, velocity = 0.9): void {
    this.unlock();
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    scheduleVoice(ctx, master, { instrument, midi, velocity, durationSec: 0.5 }, ctx.currentTime);
  }

  // ── recording ──────────────────────────────────────────────────────────────

  isRecording(): boolean {
    return this.rec !== null;
  }

  /** Called with every finished take (after stopRecording() or a transport stop). */
  onRecordingComplete(listener: (take: RecordedTake) => void): () => void {
    this.recordingListeners.add(listener);
    return () => this.recordingListeners.delete(listener);
  }

  /** Route the live input to the master while recording (off by default). */
  setInputMonitoring(enabled: boolean): void {
    this.monitoring = enabled;
    if (this.rec && this.ctx) {
      this.rec.monitor.gain.setTargetAtTime(enabled ? 1 : 0, this.ctx.currentTime, 0.02);
    }
  }

  isInputMonitoring(): boolean {
    return this.monitoring;
  }

  /**
   * Arm the microphone and start the transport from the playhead (with the
   * project's count-in). The take is captured sample-accurately in an
   * AudioWorklet; stopRecording() (or stop()) finishes it.
   * Call from a user gesture (permission prompt + AudioContext unlock).
   */
  async startRecording(trackId: string): Promise<void> {
    const project = this.project;
    if (this.rec) throw new Error('Already recording');
    if (!project) throw new Error('No project loaded');
    const track = project.tracks.find((t) => t.id === trackId);
    if (!track || trackKind(track) !== 'audio') throw new Error('Recording needs an audio track');
    this.unlock();
    const ctx = this.ctx;
    const section = this.masterSection;
    if (!ctx || !section) throw new Error('Audio is unavailable');
    if (ctx.state === 'suspended') await ctx.resume();
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser cannot record audio');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    try {
      if (this.captureModuleCtx !== ctx) {
        const url = URL.createObjectURL(
          new Blob([CAPTURE_WORKLET_SOURCE], { type: 'application/javascript' }),
        );
        try {
          await ctx.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        this.captureModuleCtx = ctx;
      }
    } catch (error) {
      for (const t of stream.getTracks()) t.stop();
      throw error;
    }

    const input = ctx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(ctx, CAPTURE_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    // The worklet must be pulled by the graph; route it to a silent sink.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    const monitor = ctx.createGain();
    monitor.gain.value = this.monitoring ? 1 : 0;
    input.connect(worklet).connect(sink).connect(ctx.destination);
    input.connect(monitor).connect(section.bus);

    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    // Latency compensation: what the player hears at transport time t left the
    // speakers outputLatency later; their sound enters the graph ~baseLatency
    // after that. Shift the take earlier by both.
    const compensationSec = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    const rec: ActiveRecording = {
      trackId,
      stream,
      input,
      worklet,
      sink,
      monitor,
      blocks: [],
      captureStartTime: null,
      sampleRate: ctx.sampleRate,
      startBeat: 0,
      epoch: 0,
      compensationSec,
      done,
      finishing: null,
    };
    worklet.port.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (!isCaptureMessage(data)) return;
      if (data.type === 'done') {
        resolveDone();
        return;
      }
      if (rec.captureStartTime === null) rec.captureStartTime = data.time;
      rec.blocks.push(data.samples);
    };
    this.rec = rec;
    this.play(this.currentBeat());
    rec.startBeat = this.playStartBeat;
    rec.epoch = this.epoch;
  }

  /** Finish the take: stops the transport, stores a WAV, resolves the take. */
  stopRecording(): Promise<RecordedTake> {
    const rec = this.rec;
    if (!rec) return Promise.reject(new Error('Not recording'));
    if (rec.finishing) return rec.finishing;
    rec.finishing = this.finishRecording(rec);
    return rec.finishing;
  }

  private async finishRecording(rec: ActiveRecording): Promise<RecordedTake> {
    rec.worklet.port.postMessage('stop');
    await Promise.race([rec.done, new Promise<void>((r) => setTimeout(r, 500))]);
    this.teardownRecording(rec);
    if (this.state !== 'stopped') this.stop();

    const total = rec.blocks.reduce((n, b) => n + b.length, 0);
    const captureStart = rec.captureStartTime ?? rec.epoch;
    const trim = recordingTrimFrames(captureStart, rec.epoch, rec.compensationSec, rec.sampleRate);
    // A capture that began after the aligned point starts the take later.
    const lateSec = Math.max(0, captureStart - (rec.epoch + rec.compensationSec));
    const frames = total - trim;
    if (frames <= 0) throw new Error('Recording stopped before the count-in finished');

    const samples = new Float32Array(frames);
    let read = 0;
    let written = 0;
    for (const block of rec.blocks) {
      const from = Math.max(0, trim - read);
      if (from < block.length) {
        samples.set(block.subarray(from), written);
        written += block.length - from;
      }
      read += block.length;
    }
    const ctx = this.ctx ?? new OfflineAudioContext(1, 1, rec.sampleRate);
    const buffer = ctx.createBuffer(1, frames, rec.sampleRate);
    buffer.getChannelData(0).set(samples);

    const stamp = new Date();
    const name = `Take ${stamp.toTimeString().slice(0, 8)}`;
    const source = await putAudio(audioBufferToWav(buffer), `${name}.wav`);
    this.buffers.set(source, buffer);
    const take: RecordedTake = {
      trackId: rec.trackId,
      source,
      name,
      durationSec: buffer.duration,
      startBeat: rec.startBeat + lateSec / this.secPerBeat(),
    };
    for (const listener of this.recordingListeners) listener(take);
    return take;
  }

  private teardownRecording(rec: ActiveRecording): void {
    rec.worklet.port.onmessage = null;
    rec.input.disconnect();
    rec.worklet.disconnect();
    rec.sink.disconnect();
    rec.monitor.disconnect();
    for (const t of rec.stream.getTracks()) t.stop();
    if (this.rec === rec) this.rec = null;
  }

  private discardRecording(): void {
    const rec = this.rec;
    if (!rec) return;
    rec.finishing ??= Promise.reject(new Error('Recording discarded'));
    rec.finishing.catch(() => undefined);
    this.teardownRecording(rec);
  }

  // ── offline export ─────────────────────────────────────────────────────────

  /**
   * Render the arrangement (loop range ignored; sample 0 = beat 0) through the
   * same graph as playback — insert FX, reverb bus, master gain and limiter —
   * to a stereo 44.1 kHz buffer, including a reverb tail. With `tracks`, only
   * those tracks render and their mute/solo flags are ignored (stems).
   */
  async renderMix(project: DawProject, opts: { tracks?: string[] } = {}): Promise<AudioBuffer> {
    const only = opts.tracks ? new Set(opts.tracks) : null;
    const included = (track: DawTrack): boolean =>
      only ? only.has(track.id) : trackAudible(project, track);
    const tracks = project.tracks.filter(included);

    const sources = new Set<string>();
    for (const track of tracks) {
      if (trackKind(track) !== 'audio') continue;
      for (const region of audioRegionsOf(track)) sources.add(region.source);
    }
    await Promise.all(
      [...sources].map((s) => {
        this.failed.delete(s);
        return this.decode(s).catch(() => null);
      }),
    );

    const secPerBeat = 60 / project.bpm;
    const lengthSec = projectEndBeat(project) * secPerBeat + REVERB_DECAY_SEC + 0.5;
    const ctx = new OfflineAudioContext(2, Math.ceil(lengthSec * 44100), 44100);
    const section = buildMasterSection(ctx, ctx.destination, project.masterGain);
    const strips = new Map<string, TrackStrip>();
    for (const track of tracks) {
      strips.set(
        track.id,
        buildTrackStrip(ctx, section.bus, section.reverbIn, stripParamsFor(project, track, true)),
      );
    }
    for (const event of flattenNotes(project, included)) {
      const strip = strips.get(event.trackId);
      if (strip) scheduleVoice(ctx, strip.input, event, event.timeSec);
    }
    for (const track of tracks) {
      const strip = strips.get(track.id);
      if (!strip || trackKind(track) !== 'audio') continue;
      for (const region of audioRegionsOf(track)) {
        const buffer = this.buffers.get(region.source);
        if (!buffer) continue;
        const segments = regionSegments(region, secPerBeat, buffer.duration);
        for (const clip of clipsInWindow(segments, OPEN_SPAN, 0, Infinity)) {
          startClip(ctx, strip.input, buffer, clip, clip.unfoldedStart);
        }
      }
    }
    return ctx.startRendering();
  }

  /** The full mix (mute/solo respected). Kept for the Tier 1 export button. */
  renderMixdown(project: DawProject): Promise<AudioBuffer> {
    return this.renderMix(project);
  }
}

/** Mix helper the UI reads to grey out non-audible tracks. */
export function trackAudible(project: DawProject, track: DawTrack): boolean {
  const anySolo = project.tracks.some((t) => t.solo);
  return anySolo ? track.solo : !track.muted;
}
