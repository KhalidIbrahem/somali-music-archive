'use client';

/**
 * DemoPlayer (Stage 2) — the landing page's research-demo audio card:
 * play/pause, a peak waveform drawn from the actual samples, click-to-seek,
 * and a live progress tint. Two sources, one pipeline:
 *   • file demos  — fetch + decodeAudioData;
 *   • engine demos — the shared qaraami engine renders oud + durbaan into a
 *     buffer on the visitor's machine (no hosted audio at all).
 * The AudioContext is created inside the first tap (mobile Safari rule) and
 * everything is buffer playback, so pause/resume is suspend/resume and seek
 * is a source restart at an offset.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ResearchDemo } from '@/lib/demos';
import { renderPerformance, toAudioBuffer, type ScoreData } from '@/lib/audio/qaraamiEngine';

const WAVE_COLUMNS = 640;

/** Decoded/rendered audio cached per demo slug — replay and re-mounts are instant. */
const bufferCache = new Map<
  string,
  { peaks: Float32Array; durationSec: number; buffer: AudioBuffer }
>();

function computePeaks(buffer: AudioBuffer): Float32Array {
  const data = buffer.getChannelData(0);
  const peaks = new Float32Array(WAVE_COLUMNS);
  const bucket = Math.max(1, Math.floor(data.length / WAVE_COLUMNS));
  for (let c = 0; c < WAVE_COLUMNS; c++) {
    let max = 0;
    const start = c * bucket;
    const end = Math.min(data.length, start + bucket);
    for (let i = start; i < end; i++) max = Math.max(max, Math.abs(data[i] ?? 0));
    peaks[c] = max;
  }
  return peaks;
}

async function loadDemoAudio(
  demo: ResearchDemo,
  ctx: AudioContext,
): Promise<{ peaks: Float32Array; durationSec: number; buffer: AudioBuffer }> {
  const cached = bufferCache.get(demo.slug);
  if (cached) return cached;
  let buffer: AudioBuffer;
  if (demo.source.kind === 'engine') {
    const res = await fetch(demo.source.notesUrl);
    if (!res.ok) throw new Error(`notes fetch failed (${res.status})`);
    const score = (await res.json()) as ScoreData;
    buffer = toAudioBuffer(ctx, renderPerformance(score));
  } else {
    const res = await fetch(demo.source.src);
    if (!res.ok) throw new Error(`audio fetch failed (${res.status})`);
    buffer = await ctx.decodeAudioData(await res.arrayBuffer());
  }
  const entry = { peaks: computePeaks(buffer), durationSec: buffer.duration, buffer };
  bufferCache.set(demo.slug, entry);
  return entry;
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type PlayerState = 'idle' | 'loading' | 'playing' | 'paused';

export function DemoPlayer({ demo }: { demo: ResearchDemo }): React.JSX.Element {
  const [state, setState] = useState<PlayerState>('idle');
  const [error, setError] = useState<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const srcRef = useRef<AudioBufferSourceNode | null>(null);
  /** Context-clock time at which playback of the current source began, minus its offset. */
  const originRef = useRef(0);
  const durationRef = useRef(0);
  const rafRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const stateRef = useRef<PlayerState>('idle');
  stateRef.current = state;

  const draw = useCallback(
    (progress: number): void => {
      const canvas = canvasRef.current;
      const entry = bufferCache.get(demo.slug);
      if (!canvas) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      const g = canvas.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const styles = getComputedStyle(canvas);
      const played = styles.getPropertyValue('--accent-state').trim() || '#C89B5F';
      const rest = styles.getPropertyValue('--text-low').trim() || '#6b6b76';
      const peaks = entry?.peaks;
      const mid = h / 2;
      const colW = w / WAVE_COLUMNS;
      for (let c = 0; c < WAVE_COLUMNS; c++) {
        // Flat bed before audio is loaded — the card never looks broken.
        const p = peaks ? Math.max(0.02, peaks[c] ?? 0) : 0.05;
        const bar = Math.max(1, p * (h * 0.92));
        g.fillStyle = c / WAVE_COLUMNS <= progress ? played : rest;
        g.globalAlpha = c / WAVE_COLUMNS <= progress ? 1 : 0.45;
        g.fillRect(c * colW, mid - bar / 2, Math.max(1, colW * 0.7), bar);
      }
      g.globalAlpha = 1;
    },
    [demo.slug],
  );

  useEffect(() => {
    draw(0);
    const onResize = (): void => draw(currentProgress());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw]);

  const currentProgress = (): number => {
    const ctx = ctxRef.current;
    if (!ctx || durationRef.current === 0) return 0;
    return Math.min(1, (ctx.currentTime - originRef.current) / durationRef.current);
  };

  const stopTicker = (): void => cancelAnimationFrame(rafRef.current);

  const finish = useCallback((): void => {
    stopTicker();
    srcRef.current = null;
    draw(1);
    if (clockRef.current) clockRef.current.textContent = formatClock(durationRef.current);
    // Back to idle: the next press replays from the cached buffer at 0.
    setState('idle');
  }, [draw]);

  const tick = useCallback((): void => {
    const progress = currentProgress();
    draw(progress);
    if (clockRef.current) {
      clockRef.current.textContent = formatClock(progress * durationRef.current);
    }
    if (progress >= 1) {
      finish();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw, finish]);

  /** Start (or restart) buffer playback at `offsetSec`. */
  const startAt = useCallback(
    (offsetSec: number): void => {
      const ctx = ctxRef.current;
      const entry = bufferCache.get(demo.slug);
      if (!ctx || !entry) return;
      srcRef.current?.stop();
      const src = ctx.createBufferSource();
      src.buffer = entry.buffer;
      src.connect(ctx.destination);
      src.start(0, offsetSec);
      srcRef.current = src;
      originRef.current = ctx.currentTime - offsetSec;
      durationRef.current = entry.durationSec;
      setState('playing');
      stopTicker();
      rafRef.current = requestAnimationFrame(tick);
    },
    [demo.slug, tick],
  );

  const toggle = useCallback((): void => {
    const ctx = ctxRef.current;
    if (stateRef.current === 'playing' && ctx) {
      stopTicker();
      void ctx.suspend().then(() => setState('paused'));
      return;
    }
    if (stateRef.current === 'paused' && ctx) {
      void ctx.resume().then(() => {
        setState('playing');
        rafRef.current = requestAnimationFrame(tick);
      });
      return;
    }
    if (stateRef.current === 'loading') return;
    // First press: context born in the gesture, then load/render + play.
    setError(null);
    setState('loading');
    const freshCtx = ctxRef.current ?? new AudioContext();
    ctxRef.current = freshCtx;
    void loadDemoAudio(demo, freshCtx)
      .then(() => {
        if (ctxRef.current !== freshCtx) return;
        draw(0);
        startAt(0);
      })
      .catch(() => {
        setError('Could not load this demo. Please try again.');
        setState('idle');
      });
  }, [demo, draw, startAt, tick]);

  const seek = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): void => {
      const entry = bufferCache.get(demo.slug);
      const ctx = ctxRef.current;
      if (!entry || !ctx || stateRef.current === 'loading') return;
      const rect = e.currentTarget.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      void ctx.resume().then(() => startAt(frac * entry.durationSec));
    },
    [demo.slug, startAt],
  );

  useEffect(
    () => () => {
      stopTicker();
      srcRef.current?.stop();
      const ctx = ctxRef.current;
      ctxRef.current = null;
      if (ctx && ctx.state !== 'closed') void ctx.close();
    },
    [],
  );

  const playing = state === 'playing';

  return (
    <article className="rounded-[4px] border border-hairline bg-chrome-1 p-6">
      <h3 className="font-display text-xl text-hi">{demo.title}</h3>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-mid">{demo.paragraph}</p>

      <div className="mt-5 flex items-center gap-4">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? `Pause ${demo.title}` : `Play ${demo.title}`}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-state text-page transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none motion-reduce:transition-none"
        >
          {state === 'loading' ? (
            <span
              aria-hidden
              className="h-4 w-4 animate-spin rounded-full border-2 border-page/40 border-t-page"
            />
          ) : playing ? (
            <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
              <rect x="2" y="1.5" width="3" height="9" />
              <rect x="7" y="1.5" width="3" height="9" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
              <path d="M3 1.4v9.2L11 6 3 1.4Z" />
            </svg>
          )}
        </button>

        <canvas
          ref={canvasRef}
          onClick={seek}
          aria-hidden
          className="h-16 min-w-0 flex-1 cursor-pointer"
        />

        <span className="numeric shrink-0 text-xs text-hi">
          <span ref={clockRef}>0:00</span>
          <span className="text-low">
            {' '}
            / {durationRef.current > 0 ? formatClock(durationRef.current) : '·'}
          </span>
        </span>
      </div>

      {error !== null ? (
        <p role="alert" className="mt-3 text-xs text-mid">
          {error}
        </p>
      ) : null}
      {demo.credit ? (
        <p className="numeric mt-4 text-[11px] tracking-[0.16em] text-low uppercase">
          {demo.credit}
        </p>
      ) : null}
    </article>
  );
}
