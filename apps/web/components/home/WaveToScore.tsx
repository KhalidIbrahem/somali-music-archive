'use client';

/**
 * WaveToScore — the waveform-to-notation morph (landing §"The work").
 *
 * The real hero-excerpt waveform (decoded from the same mp3 the hero plays)
 * cross-fades into the real engraving as the section crosses the viewport —
 * a scroll-driven restoration reveal using nothing but opacity and a small
 * translate, so it never jankes. Reduced motion collapses the morph to a
 * static side-by-side.
 */

import { useEffect, useRef } from 'react';
import { loadPeaks } from '@/components/player/peaks';

export function WaveToScore({ scoreSvg }: { scoreSvg: string }): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const scoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (canvas === null || root === null) return undefined;
    let cancelled = false;

    // Decode nothing until the section approaches: the landing's audio stays
    // lazy and the load path stays quiet (perf budget).
    const decodeWhenNear = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        decodeWhenNear.disconnect();
        void loadPeaks('/sample/hero-audio.mp3', 400).then((peaks) => {
          if (cancelled || peaks === null || canvasRef.current === null) return;
          const c = canvasRef.current;
          const dpr = window.devicePixelRatio || 1;
          const w = c.clientWidth;
          const h = c.clientHeight;
          c.width = Math.round(w * dpr);
          c.height = Math.round(h * dpr);
          const ctx = c.getContext('2d');
          if (ctx === null) return;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          const ink = getComputedStyle(document.documentElement)
            .getPropertyValue('--accent-state')
            .trim();
          ctx.fillStyle = ink;
          const mid = h / 2;
          for (let x = 0; x < w; x++) {
            const i = Math.floor((x / w) * peaks.mins.length);
            const lo = peaks.mins[i] ?? 0;
            const hi = peaks.maxs[i] ?? 0;
            const y0 = mid - hi * (mid - 4);
            ctx.fillRect(x, y0, 1, Math.max(1, (hi - lo) * (mid - 4)));
          }
        });
      },
      { rootMargin: '600px 0px' },
    );
    decodeWhenNear.observe(root);

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      // static reveal: both visible, no scroll binding
      if (waveRef.current) waveRef.current.style.opacity = '0.45';
      if (scoreRef.current) scoreRef.current.style.opacity = '1';
      return () => {
        cancelled = true;
        decodeWhenNear.disconnect();
      };
    }

    let raf = 0;
    const onScroll = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const root = rootRef.current;
        if (root === null) return;
        const r = root.getBoundingClientRect();
        const vh = window.innerHeight;
        // progress 0 → 1 as the section travels the middle half of the viewport
        const p = Math.min(1, Math.max(0, (vh * 0.75 - r.top) / (vh * 0.6)));
        if (waveRef.current) {
          waveRef.current.style.opacity = String(1 - p * 0.9);
          waveRef.current.style.transform = `translateY(${p * -12}px)`;
        }
        if (scoreRef.current) {
          scoreRef.current.style.opacity = String(0.1 + p * 0.9);
          scoreRef.current.style.transform = `translateY(${(1 - p) * 12}px)`;
        }
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelled = true;
      decodeWhenNear.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <div ref={waveRef} className="transition-opacity duration-150 motion-reduce:transition-none">
        <canvas ref={canvasRef} className="h-24 w-full" aria-hidden />
      </div>
      <div
        ref={scoreRef}
        className="hero-score mt-2 rounded-[2px] bg-paper p-4 ring-1 ring-paper-edge transition-opacity duration-150 [&_svg]:h-auto [&_svg]:w-full motion-reduce:transition-none"
        dangerouslySetInnerHTML={{ __html: scoreSvg }}
      />
    </div>
  );
}
