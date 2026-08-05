'use client';

/**
 * Waveform strip (96px) — the audio on the studio's shared time axis (B1-04).
 *
 * The axis domain is the SESSION duration (the score's time span), never the
 * decoded buffer's — mp3 framing pads the buffer by a few tens of ms, and the
 * score end and waveform end must be the same instant. Peaks, ruler ticks,
 * and (in B1-05) the playhead all position through timelineMath's single
 * view→pixel map, so start/end land exactly where the axis says they do at
 * every zoom level. Rendering is imperative on a DPR-aware canvas: the view
 * window lives in a ref and redraws never pass through React state.
 *
 * Interactions: wheel zooms time around the pointer; drag pans. Colors read
 * the live token values so the strip follows theme switches (MutationObserver
 * on html[data-theme]).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStudio } from './StudioState';
import { loadSampleBuffer } from './audio';
import { clampView, tickStep, timeToX, xToTime, type TimeView } from './timelineMath';
import { formatDuration } from './format';

const RULER_PX = 20;

function tokenColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

type StripStatus = 'loading' | 'ready' | 'error';

export function WaveformStrip(): React.JSX.Element {
  const { session } = useStudio();
  const [status, setStatus] = useState<StripStatus>('loading');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  /** Timeline domain end — the session duration (score time span). */
  const totalRef = useRef<number | null>(null);
  const viewRef = useRef<TimeView | null>(null);
  const dragRef = useRef<{ pointerX: number; viewStart: number } | null>(null);

  const draw = useCallback((): void => {
    const canvas = canvasRef.current;
    const buffer = bufferRef.current;
    const view = viewRef.current;
    if (canvas === null || buffer === null || view === null) return;

    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(cssWidth * dpr)) canvas.width = Math.round(cssWidth * dpr);
    if (canvas.height !== Math.round(cssHeight * dpr)) canvas.height = Math.round(cssHeight * dpr);

    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const inkMid = tokenColor('--text-mid');
    const inkLow = tokenColor('--text-low');
    const hairline = tokenColor('--hairline');

    // ── ruler ────────────────────────────────────────────────────────────
    const step = tickStep(view, cssWidth);
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.fillStyle = inkLow;
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    const firstTick = Math.ceil(view.start / step) * step;
    for (let t = firstTick; t <= view.start + view.duration + 1e-9; t += step) {
      const x = Math.round(timeToX(t, view, cssWidth)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, cssHeight);
      ctx.stroke();
      ctx.fillText(formatDuration(t).slice(3), x + 4, 13);
    }

    // ── peaks ────────────────────────────────────────────────────────────
    const data = buffer.getChannelData(0);
    const sr = buffer.sampleRate;
    const total = totalRef.current ?? buffer.duration;
    const mid = RULER_PX + (cssHeight - RULER_PX) / 2;
    const amp = (cssHeight - RULER_PX) / 2 - 4;
    ctx.fillStyle = inkMid;
    const px0 = Math.max(0, Math.floor(timeToX(0, view, cssWidth)));
    const px1 = Math.min(cssWidth, Math.ceil(timeToX(total, view, cssWidth)));
    for (let x = px0; x < px1; x++) {
      const t0 = xToTime(x, view, cssWidth);
      const t1 = xToTime(x + 1, view, cssWidth);
      const s0 = Math.max(0, Math.floor(t0 * sr));
      const s1 = Math.min(data.length, Math.max(s0 + 1, Math.ceil(t1 * sr)));
      let min = 1;
      let max = -1;
      const stride = Math.max(1, Math.floor((s1 - s0) / 64));
      for (let s = s0; s < s1; s += stride) {
        const v = data[s] ?? 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (min > max) continue;
      const y0 = mid - max * amp;
      const y1 = mid - min * amp;
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }

    // center line over silence keeps the axis legible
    ctx.fillStyle = hairline;
    ctx.fillRect(0, Math.round(mid), cssWidth, 1);
  }, []);

  // Data: decode once; the axis domain comes from the session.
  useEffect(() => {
    if (session === null) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const buffer = await loadSampleBuffer();
        if (cancelled) return;
        bufferRef.current = buffer;
        totalRef.current = session.meta.durationSec;
        viewRef.current = { start: 0, duration: session.meta.durationSec };
        setStatus('ready');
        draw();
        if (process.env.NODE_ENV !== 'production') {
          // verification hook: the exact map the renderer uses (cdp harness)
          (window as unknown as Record<string, unknown>)['__waveformDebug'] = {
            xOf: (t: number) =>
              viewRef.current === null || canvasRef.current === null
                ? null
                : timeToX(t, viewRef.current, canvasRef.current.clientWidth),
            view: () => viewRef.current,
            total: session.meta.durationSec,
            bufferDuration: buffer.duration,
            width: () => canvasRef.current?.clientWidth ?? null,
          };
        }
      } catch (err) {
        console.error('[studio] waveform decode failed:', err);
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, draw]);

  // Interactions + observers, once.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;

    const onWheel = (e: WheelEvent): void => {
      const total = totalRef.current;
      const view = viewRef.current;
      if (total === null || view === null) return;
      e.preventDefault();
      const width = canvas.clientWidth;
      const anchorT = xToTime(e.offsetX, view, width);
      const factor = Math.pow(1.0015, e.deltaY);
      const duration = view.duration * factor;
      const start = anchorT - (anchorT - view.start) * factor;
      viewRef.current = clampView({ start, duration }, total);
      draw();
    };

    const onPointerDown = (e: PointerEvent): void => {
      if (viewRef.current === null) return;
      dragRef.current = { pointerX: e.clientX, viewStart: viewRef.current.start };
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent): void => {
      const drag = dragRef.current;
      const total = totalRef.current;
      const view = viewRef.current;
      if (drag === null || total === null || view === null) return;
      const dx = e.clientX - drag.pointerX;
      const dt = (dx / canvas.clientWidth) * view.duration;
      viewRef.current = clampView({ start: drag.viewStart - dt, duration: view.duration }, total);
      draw();
    };
    const onPointerUp = (): void => {
      dragRef.current = null;
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);

    const resize = new ResizeObserver(draw);
    resize.observe(canvas);
    const themeWatch = new MutationObserver(draw);
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      resize.disconnect();
      themeWatch.disconnect();
    };
  }, [draw]);

  return (
    <section
      aria-label="Waveform"
      className="relative h-(--studio-waveform) shrink-0 border-t border-hairline bg-chrome-1 print:hidden"
    >
      {status === 'loading' && (
        <p className="absolute top-2 left-4 z-10 text-[11px] text-low">Decoding audio…</p>
      )}
      {status === 'error' && (
        <p className="absolute top-2 left-4 z-10 text-[11px] text-low">
          The audio could not load. Reload the page to try again.
        </p>
      )}
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        aria-label={
          session === null
            ? 'Audio waveform'
            : `Audio waveform, ${formatDuration(session.meta.durationSec)} total`
        }
      />
    </section>
  );
}
