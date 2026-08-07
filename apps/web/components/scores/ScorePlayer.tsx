'use client';

/**
 * ScorePlayer — performs a transcribed melody in the browser (Beerdilaacshe).
 *
 * No General MIDI piano. The melody voice is oud-like plucked-string
 * synthesis (Karplus-Strong: each note is a doubled course — two strings a
 * few cents apart — with a faint octave-below resonance; warm, plucked,
 * slightly detuned). This is the fallback the brief explicitly allows in
 * place of a licensed oud sample set, which this project won't ship
 * unvetted. Underneath, a durbaan-style frame-drum groove in 4/4 at the
 * score's own tempo: low dum strokes and high tak strokes, mixed well under
 * the melody, starting and stopping with it.
 *
 * The whole mix is pre-rendered into one AudioBuffer on the first press
 * (~200ms), then played through a dedicated AudioContext — pause is
 * ctx.suspend(), resume is ctx.resume(), and the progress bar reads the
 * context clock. The context is created inside the click handler, which is
 * what mobile Safari requires.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDuration } from '@/components/studio/format';

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

const SR = 24000;
const TAIL = 2.0;

/** One Karplus-Strong pluck added into `out` at `at` seconds. */
function pluck(
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
function dum(out: Float32Array, at: number, gain: number): void {
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
function tak(out: Float32Array, at: number, gain: number): void {
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

function renderMix(data: ScoreData): Float32Array {
  const out = new Float32Array(Math.ceil((data.durationSec + TAIL) * SR));

  // melody: oud-like doubled course + faint lower octave
  for (const n of data.notes) {
    const f = 440 * Math.pow(2, (n.midi - 69) / 12);
    const ring = Math.min(2.5, Math.max(0.5, n.end - n.start + 0.35));
    const g = 0.32 * (0.55 + 0.45 * n.velocity);
    pluck(out, n.start, f * Math.pow(2, -5 / 1200), ring, g, n.midi * 2654435761);
    pluck(out, n.start + 0.006, f * Math.pow(2, 5 / 1200), ring, g * 0.8, n.midi * 40503 + 7);
    pluck(out, n.start + 0.003, f / 2, ring * 0.8, g * 0.16, n.midi * 69069 + 13);
  }

  // durbaan groove per 4/4 bar: dum 1 · tak 2 · ghost and-of-2 · dum 3 · tak 4
  const beat = 60 / data.bpm;
  for (let t0 = 0; t0 < data.durationSec - 0.05; t0 += 4 * beat) {
    dum(out, t0, 0.34);
    tak(out, t0 + 1 * beat, 0.2);
    tak(out, t0 + 1.75 * beat, 0.09);
    dum(out, t0 + 2 * beat, 0.22);
    tak(out, t0 + 3 * beat, 0.2);
  }

  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) {
    const k = 0.86 / peak;
    for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) * k;
  }
  return out;
}

type PlayerState = 'idle' | 'preparing' | 'playing' | 'paused';

export function ScorePlayer({ data }: { data: ScoreData }): React.JSX.Element {
  const [state, setState] = useState<PlayerState>('idle');
  const ctxRef = useRef<AudioContext | null>(null);
  const mixRef = useRef<Float32Array | null>(null);
  const rafRef = useRef(0);
  const barRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);

  const teardown = useCallback((): void => {
    cancelAnimationFrame(rafRef.current);
    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx !== null && ctx.state !== 'closed') void ctx.close();
  }, []);

  useEffect(() => teardown, [teardown]);

  const stop = useCallback((): void => {
    teardown();
    setState('idle');
    if (barRef.current) barRef.current.style.width = '0%';
    if (clockRef.current) clockRef.current.textContent = formatDuration(0);
  }, [teardown]);

  const startLoop = useCallback((): void => {
    const end = data.durationSec + 0.4;
    const loop = (): void => {
      const ctx = ctxRef.current;
      if (ctx === null) return;
      const t = Math.min(ctx.currentTime, end);
      if (barRef.current) barRef.current.style.width = `${(t / data.durationSec) * 100}%`;
      if (clockRef.current)
        clockRef.current.textContent = formatDuration(Math.min(t, data.durationSec));
      if (t >= end) {
        stop();
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [data.durationSec, stop]);

  const toggle = useCallback((): void => {
    const current = ctxRef.current;
    if (state === 'playing' && current !== null) {
      cancelAnimationFrame(rafRef.current);
      void current.suspend().then(() => setState('paused'));
      return;
    }
    if (state === 'paused' && current !== null) {
      void current.resume().then(() => {
        setState('playing');
        startLoop();
      });
      return;
    }
    if (state === 'preparing') return;
    // fresh start — the context is born inside the gesture (mobile Safari)
    setState('preparing');
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    setTimeout(() => {
      if (ctxRef.current !== ctx) return; // stopped while preparing
      mixRef.current ??= renderMix(data);
      const mix = mixRef.current;
      const buffer = ctx.createBuffer(1, mix.length, SR);
      buffer.getChannelData(0).set(mix);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start();
      setState('playing');
      startLoop();
    }, 30);
  }, [state, data, startLoop]);

  return (
    <div className="rounded-[4px] border border-hairline bg-chrome-1 p-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={state === 'playing' ? 'Pause' : 'Play'}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] border border-hairline bg-chrome-2 text-accent-live transition-colors hover:text-hi focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
        >
          {state === 'playing' || state === 'preparing' ? (
            <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
              <rect x="2" y="1.5" width="3" height="9" />
              <rect x="7" y="1.5" width="3" height="9" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
              <path d="M2.5 1.2v9.6L11 6 2.5 1.2Z" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={state === 'idle'}
          aria-label="Stop"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-mid transition-colors hover:text-hi focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none disabled:cursor-not-allowed disabled:text-low"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
            <rect x="1.5" y="1.5" width="9" height="9" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-chrome-2">
            <div ref={barRef} className="h-full w-0 rounded-full bg-accent-live" />
          </div>
        </div>
        <span className="numeric shrink-0 text-xs text-hi">
          <span ref={clockRef}>{formatDuration(0)}</span>
          <span className="text-low"> / {formatDuration(data.durationSec)}</span>
        </span>
      </div>
      <p className="numeric mt-3 text-[11px] tracking-[0.14em] text-low uppercase">
        {state === 'preparing'
          ? 'Preparing the performance…'
          : `♩ = ${data.bpm} · ${data.timeSignature} · oud (plucked synthesis) · durbaan`}
      </p>
    </div>
  );
}
