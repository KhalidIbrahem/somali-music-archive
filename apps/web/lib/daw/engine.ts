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
 * The same scheduling code renders WAV mixdowns through an
 * OfflineAudioContext — what you hear is exactly what exports.
 */

import { ENGINE_SAMPLE_RATE, dum, normalize, pluck, tak } from '@/lib/audio/qaraamiEngine';
import type { DawProject, DawTrack, InstrumentId } from './types';
import { projectEndBeat } from './types';

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

// ── Per-track output chain ───────────────────────────────────────────────────

interface TrackChain {
  input: GainNode;
  gain: GainNode;
  pan: StereoPannerNode;
  analyser: AnalyserNode;
}

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
function flattenNotes(project: DawProject): ScheduledNote[] {
  const secPerBeat = 60 / project.bpm;
  const events: ScheduledNote[] = [];
  const anySolo = project.tracks.some((t) => t.solo);
  for (const track of project.tracks) {
    const audible = anySolo ? track.solo : !track.muted;
    if (!audible) continue;
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

// ── The engine ───────────────────────────────────────────────────────────────

export class DawEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private chains = new Map<string, TrackChain>();
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

  // ── lifecycle ──────────────────────────────────────────────────────────────

  /** Create/resume the AudioContext. MUST be called from a user gesture once. */
  unlock(): void {
    if (this.ctx === null) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.project?.masterGain ?? 1;
      this.master.connect(this.ctx.destination);
      if (this.project) this.rebuildChains();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
    const ctx = this.ctx;
    this.ctx = null;
    this.chains.clear();
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
  }

  private rebuildChains(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.project) return;
    for (const chain of this.chains.values()) chain.input.disconnect();
    this.chains.clear();
    for (const track of this.project.tracks) {
      const input = ctx.createGain();
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      input.connect(gain).connect(pan).connect(analyser).connect(master);
      this.chains.set(track.id, { input, gain, pan, analyser });
    }
    this.applyMix();
  }

  private applyMix(): void {
    const ctx = this.ctx;
    if (!ctx || !this.project) return;
    for (const track of this.project.tracks) {
      const chain = this.chains.get(track.id);
      if (!chain) continue;
      chain.gain.gain.setTargetAtTime(track.gain, ctx.currentTime, 0.02);
      chain.pan.pan.setTargetAtTime(track.pan, ctx.currentTime, 0.02);
    }
  }

  getAnalyser(trackId: string): AnalyserNode | null {
    return this.chains.get(trackId)?.analyser ?? null;
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

  /** Live sources cannot be individually tracked cheaply; a hard stop swaps
   * the master gain to zero momentarily and rebuilds track chains. */
  private stopSources(): void {
    if (!this.ctx) return;
    this.rebuildChains();
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
        const chain = this.chains.get(event.trackId);
        if (chain) scheduleVoice(ctx, chain.input, event, this.epoch + unfolded);
      }
    }

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

    // Auto-stop past the end of the arrangement (unless looping).
    if (!loop.enabled && windowStartUnfolded > endSec + 1.5) {
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

  // ── offline export ─────────────────────────────────────────────────────────

  /** Render the full arrangement (loop range ignored) to a stereo 44.1 kHz buffer. */
  async renderMixdown(project: DawProject): Promise<AudioBuffer> {
    const secPerBeat = 60 / project.bpm;
    const lengthSec = projectEndBeat(project) * secPerBeat + 2;
    const ctx = new OfflineAudioContext(2, Math.ceil(lengthSec * 44100), 44100);
    const master = ctx.createGain();
    master.gain.value = project.masterGain;
    master.connect(ctx.destination);

    const chains = new Map<string, GainNode>();
    for (const track of project.tracks) {
      const gain = ctx.createGain();
      gain.gain.value = track.gain;
      const pan = ctx.createStereoPanner();
      pan.pan.value = track.pan;
      gain.connect(pan).connect(master);
      chains.set(track.id, gain);
    }
    for (const event of flattenNotes(project)) {
      const chain = chains.get(event.trackId);
      if (chain) scheduleVoice(ctx, chain, event, event.timeSec + 0.05);
    }
    return ctx.startRendering();
  }
}

/** Mix helper the UI reads to grey out non-audible tracks. */
export function trackAudible(project: DawProject, track: DawTrack): boolean {
  const anySolo = project.tracks.some((t) => t.solo);
  return anySolo ? track.solo : !track.muted;
}
