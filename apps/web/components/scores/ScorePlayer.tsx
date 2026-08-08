'use client';

/**
 * ScorePlayer — performs a transcribed melody in the browser (Beerdilaacshe).
 *
 * The synthesis itself (oud Karplus-Strong doubled course + durbaan groove)
 * lives in lib/audio/qaraamiEngine — ONE implementation shared with the
 * landing-page research demos and the DAW's oud instrument (studio master
 * plan: refactor, never duplicate). This component owns only playback:
 * the whole mix is pre-rendered into one AudioBuffer on the first press
 * (~200ms), then played through a dedicated AudioContext — pause is
 * ctx.suspend(), resume is ctx.resume(), and the progress bar reads the
 * context clock. The context is created inside the click handler, which is
 * what mobile Safari requires.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDuration } from '@/components/studio/format';
import {
  renderPerformance,
  toAudioBuffer,
  type ScoreData,
  type ScoreNote,
} from '@/lib/audio/qaraamiEngine';

export type { ScoreData, ScoreNote };

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
      mixRef.current ??= renderPerformance(data);
      const mix = mixRef.current;
      const buffer = toAudioBuffer(ctx, mix);
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
