'use client';

/**
 * ScoreCanvas — Verovio engraving on the paper surface (B1-03).
 *
 * The toolkit (WASM) loads once per page and is cached at module scope; the
 * MEI loads once into it. Zoom re-engraves via setOptions + redoLayout — the
 * SVG px width stays equal to PAPER_WIDTH while staves grow, exactly like
 * zooming in a desktop engraving app. The score flows as one tall page
 * (galley view) inside the only scrollable region of the shell.
 *
 * The first engrave is timed with performance.mark/measure('engrave') —
 * B1-03's pass criterion is < 500ms.
 */

import { useEffect, useRef, useState } from 'react';
import type { VerovioToolkit } from 'verovio/esm';
import { useStudio } from './StudioState';

/** SVG pixel width — the engraved content width on the paper (8px grid). */
export const PAPER_WIDTH = 816;

/** Verovio scale at 100% zoom. */
const BASE_SCALE = 40;

let engraverPromise: Promise<{ toolkit: VerovioToolkit; mei: string }> | null = null;

function getEngraver(): Promise<{ toolkit: VerovioToolkit; mei: string }> {
  engraverPromise ??= (async () => {
    const [{ default: createVerovioModule }, { VerovioToolkit: Toolkit }, mei] = await Promise.all([
      import('verovio/wasm'),
      import('verovio/esm'),
      fetch('/sample/score.mei').then((res) => {
        if (!res.ok) throw new Error(`score fetch failed (${res.status})`);
        return res.text();
      }),
    ]);
    const module = await createVerovioModule();
    return { toolkit: new Toolkit(module), mei };
  })();
  return engraverPromise;
}

function engraveOptions(zoomPercent: number): Record<string, unknown> {
  const scale = Math.round((BASE_SCALE * zoomPercent) / 100);
  return {
    scale,
    pageWidth: Math.round((PAPER_WIDTH * 100) / scale),
    pageHeight: 60000,
    adjustPageHeight: true,
    breaks: 'auto',
    header: 'none',
    footer: 'none',
    justifyVertically: false,
  };
}

type CanvasStatus = 'loading' | 'ready' | 'error';

export function ScoreCanvas(): React.JSX.Element {
  const { zoomPercent } = useStudio();
  const [status, setStatus] = useState<CanvasStatus>('loading');
  const hostRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { toolkit, mei } = await getEngraver();
        if (cancelled) return;
        const first = !loadedRef.current;
        if (first) performance.mark('engrave:start');
        toolkit.setOptions(engraveOptions(zoomPercent));
        if (first) {
          if (!toolkit.loadData(mei)) throw new Error('verovio rejected the MEI');
          loadedRef.current = true;
        } else {
          toolkit.redoLayout({});
        }
        const svg = toolkit.renderToSVG(1);
        if (cancelled) return;
        if (hostRef.current) hostRef.current.innerHTML = svg;
        if (first) {
          performance.mark('engrave:end');
          const m = performance.measure('engrave', 'engrave:start', 'engrave:end');
          console.info(`[studio] first engrave: ${Math.round(m.duration)}ms`);
        }
        setStatus('ready');
      } catch (err) {
        console.error('[studio] engraving failed:', err);
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [zoomPercent]);

  return (
    <div className="relative">
      {status === 'loading' && (
        <p className="px-16 pb-16 text-center text-sm text-confidence-mid">Engraving the score…</p>
      )}
      {status === 'error' && (
        <p className="px-16 pb-16 text-center text-sm text-confidence-mid">
          The score could not load. Reload the page to try again.
        </p>
      )}
      {/* Verovio SVG lands here; display block kills the inline-svg baseline gap. */}
      <div ref={hostRef} className="mx-auto w-fit pb-8 [&_svg]:block" />
    </div>
  );
}
