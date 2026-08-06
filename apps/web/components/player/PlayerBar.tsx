'use client';

/**
 * PlayerBar — the persistent bottom player (B1-15). Renders only when a
 * queue exists; survives navigation because PlayerProvider owns the audio.
 *
 * Waveform scrubber (not a plain progress bar): peaks canvas + played
 * shading + flag-blue playhead, click/drag to seek. Elapsed / remaining in
 * IBM Plex Mono tabular figures. Buffering, error, and end-of-list states
 * are all designed, and the source/rights line never leaves the bar.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlayer } from './PlayerProvider';
import { loadPeaks, type Peaks } from './peaks';
import { formatDuration } from '@/components/studio/format';

function tokenColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function PlayerBar(): React.JSX.Element | null {
  const player = usePlayer();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const remainingRef = useRef<HTMLSpanElement>(null);
  const peaksRef = useRef<Peaks | null>(null);
  const timeRef = useRef(0);
  /** src whose peaks finished decoding — readiness is derived, never reset. */
  const [peaksFor, setPeaksFor] = useState<string | null>(null);

  const duration = player.track?.durationSec ?? 0;

  const draw = useCallback((): void => {
    const canvas = canvasRef.current;
    if (canvas === null || duration <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const played = Math.min(1, timeRef.current / duration);
    const mid = h / 2;
    const peaks = peaksRef.current;
    const inkMid = tokenColor('--text-mid');
    const inkLow = tokenColor('--text-low');
    const live = tokenColor('--accent-live');

    if (peaks !== null) {
      const amp = h / 2 - 2;
      for (let x = 0; x < w; x++) {
        const c = Math.floor((x / w) * peaks.mins.length);
        const lo = peaks.mins[c] ?? 0;
        const hi = peaks.maxs[c] ?? 0;
        ctx.fillStyle = x / w <= played ? live : inkMid;
        ctx.globalAlpha = x / w <= played ? 0.9 : 0.55;
        const y0 = mid - hi * amp;
        ctx.fillRect(x, y0, 1, Math.max(1, (hi - lo) * amp));
      }
      ctx.globalAlpha = 1;
    } else {
      // designed fallback bed when peaks are unavailable
      ctx.fillStyle = inkLow;
      ctx.fillRect(0, mid, w, 1);
      ctx.fillStyle = live;
      ctx.fillRect(0, mid - 1, w * played, 3);
    }
    // playhead
    ctx.fillStyle = live;
    ctx.fillRect(w * played - 1, 1, 2, h - 2);
  }, [duration]);

  // clock subscription: timecodes + waveform repaint, no React re-renders
  useEffect(
    () =>
      player.onTime((t) => {
        timeRef.current = t;
        if (elapsedRef.current) elapsedRef.current.textContent = formatDuration(t);
        if (remainingRef.current)
          remainingRef.current.textContent = `-${formatDuration(Math.max(0, duration - t))}`;
        canvasRef.current?.setAttribute('aria-valuenow', String(Math.round(t)));
        draw();
      }),
    [player, duration, draw],
  );

  // peaks per track (readiness derives from which src finished decoding)
  useEffect(() => {
    const src = player.track?.src;
    if (src === undefined) return undefined;
    peaksRef.current = null;
    let cancelled = false;
    void loadPeaks(src).then((p) => {
      if (cancelled) return;
      peaksRef.current = p;
      setPeaksFor(p !== null ? src : null);
      draw();
    });
    return () => {
      cancelled = true;
    };
  }, [player.track?.src, draw]);
  const peaksReady = peaksFor === player.track?.src;

  useEffect(() => {
    const themeWatch = new MutationObserver(draw);
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    window.addEventListener('resize', draw);
    return () => {
      themeWatch.disconnect();
      window.removeEventListener('resize', draw);
    };
  }, [draw]);

  const scrubTo = useCallback(
    (clientX: number): void => {
      const canvas = canvasRef.current;
      if (canvas === null || duration <= 0) return;
      const r = canvas.getBoundingClientRect();
      player.seek(((clientX - r.left) / r.width) * duration);
    },
    [player, duration],
  );

  if (player.track === null) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-chrome-1 print:hidden">
      <div className="mx-auto flex h-20 w-full max-w-6xl items-center gap-4 px-4">
        {/* transport */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous track"
            onClick={player.prev}
            className="flex h-8 w-8 items-center justify-center rounded-[4px] text-mid transition-colors hover:text-hi focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
              <rect x="1" y="1" width="2" height="10" />
              <path d="M11 1 4 6l7 5V1Z" />
            </svg>
          </button>
          <button
            type="button"
            aria-label={player.status === 'playing' ? 'Pause' : 'Play'}
            onClick={player.toggle}
            className="flex h-10 w-10 items-center justify-center rounded-[4px] border border-hairline bg-chrome-2 text-accent-live transition-colors hover:text-hi focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
          >
            {player.status === 'playing' || player.status === 'loading' ? (
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
            aria-label="Next track"
            onClick={player.next}
            className="flex h-8 w-8 items-center justify-center rounded-[4px] text-mid transition-colors hover:text-hi focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
              <rect x="9" y="1" width="2" height="10" />
              <path d="M1 1l7 5-7 5V1Z" />
            </svg>
          </button>
        </div>

        {/* track identity + rights (always visible) + status line */}
        <div className="w-44 min-w-0 shrink-0 sm:w-56">
          <p className="truncate text-[13px] font-semibold text-hi">{player.track.title}</p>
          <p className="truncate text-[11px] text-mid">{player.track.performer}</p>
          <p className="truncate text-[10px] text-low">
            {player.status === 'loading' && 'Buffering… '}
            {player.status === 'ended' && 'End of the list — press play to start over. '}
            {player.track.rightsLine}
          </p>
        </div>

        {/* waveform scrubber */}
        <div className="relative h-12 min-w-0 flex-1">
          {player.status === 'error' ? (
            <p role="alert" className="flex h-full items-center text-[12px] text-danger">
              {player.errorMessage}
            </p>
          ) : (
            <canvas
              ref={canvasRef}
              role="slider"
              aria-label="Seek position"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={0}
              tabIndex={0}
              onPointerDown={(e) => {
                (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
                scrubTo(e.clientX);
              }}
              onPointerMove={(e) => {
                if ((e.buttons & 1) === 1) scrubTo(e.clientX);
              }}
              className="h-full w-full cursor-pointer rounded-[4px] focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
            />
          )}
          {!peaksReady && player.status !== 'error' && (
            <p className="pointer-events-none absolute inset-x-0 top-0 text-center text-[9px] text-low">
              {player.status === 'loading' ? 'Buffering…' : ''}
            </p>
          )}
        </div>

        {/* timecodes — mono, tabular; fixed width so nothing reflows */}
        <div className="numeric hidden shrink-0 text-[12px] text-mid sm:block">
          <span ref={elapsedRef} className="text-hi">
            00:00:00
          </span>{' '}
          <span ref={remainingRef} className="text-low">
            -{formatDuration(duration)}
          </span>
        </div>

        {/* volume */}
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={player.volume}
          onChange={(e) => player.setVolume(Number(e.target.value))}
          aria-label="Volume"
          className="hidden w-20 accent-(--accent-live) md:block"
        />
      </div>
    </div>
  );
}
