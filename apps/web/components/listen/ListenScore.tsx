'use client';

/**
 * ListenScore — the listening room's synced engraving (B1-15 "the binding").
 *
 * Renders the sample session's score and follows the PLAYER's clock with the
 * same cursor idea as the studio (B1-05): the sounding note is flag blue and
 * kept in view; confidence ink is baked per glyph. Read-only — the studio
 * remains the place to inspect and edit.
 */

import { useEffect, useRef, useState } from 'react';
import type { VerovioToolkit } from 'verovio/esm';
import { confidenceAlpha } from '@sma/constants';
import { usePlayer } from '@/components/player/PlayerProvider';

interface SessionNote {
  ids: string[];
  start: number;
  end: number;
  confidence: number;
}

let engraverPromise: Promise<{
  toolkit: VerovioToolkit;
  mei: string;
  notes: SessionNote[];
}> | null = null;

function getEngraver(): NonNullable<typeof engraverPromise> {
  engraverPromise ??= (async () => {
    const [{ default: createVerovioModule }, { VerovioToolkit: Toolkit }, mei, session] =
      await Promise.all([
        import('verovio/wasm'),
        import('verovio/esm'),
        fetch('/sample/score.mei').then((r) => {
          if (!r.ok) throw new Error(`score fetch ${r.status}`);
          return r.text();
        }),
        fetch('/sample/session.json').then((r) => {
          if (!r.ok) throw new Error(`session fetch ${r.status}`);
          return r.json() as Promise<{ notes: SessionNote[] }>;
        }),
      ]);
    const wasmModule = await createVerovioModule();
    return { toolkit: new Toolkit(wasmModule), mei, notes: session.notes };
  })();
  return engraverPromise;
}

export function ListenScore(): React.JSX.Element {
  const player = usePlayer();
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<SessionNote[]>([]);
  const activeRef = useRef<number | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { toolkit, mei, notes } = await getEngraver();
        if (cancelled) return;
        toolkit.setOptions({
          scale: 34,
          pageWidth: Math.round((648 * 100) / 34),
          pageHeight: 60000,
          adjustPageHeight: true,
          breaks: 'auto',
          header: 'none',
          footer: 'none',
        });
        if (!toolkit.loadData(mei)) throw new Error('verovio rejected the MEI');
        const svg = toolkit.renderToSVG(1);
        if (cancelled || hostRef.current === null) return;
        hostRef.current.innerHTML = svg;
        notesRef.current = notes;
        notes.forEach((n) => {
          const alpha = confidenceAlpha(n.confidence);
          for (const id of n.ids) {
            const el = hostRef.current?.querySelector(`#${CSS.escape(id)}`);
            if (el instanceof SVGElement) el.style.fillOpacity = String(alpha);
          }
        });
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // follow the player's clock — same one-cursor logic as the studio
  useEffect(
    () =>
      player.onTime((t) => {
        const host = hostRef.current;
        const notes = notesRef.current;
        if (host === null || notes.length === 0) return;
        let active: number | null = null;
        let lo = 0;
        let hi = notes.length - 1;
        let idx = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if ((notes[mid]?.start ?? Infinity) <= t) {
            idx = mid;
            lo = mid + 1;
          } else hi = mid - 1;
        }
        if (idx >= 0 && t < (notes[idx]?.end ?? 0)) active = idx;
        if (active === activeRef.current) return;

        const swap = (index: number | null, add: boolean): void => {
          if (index === null) return;
          for (const id of notes[index]?.ids ?? []) {
            host.querySelector(`#${CSS.escape(id)}`)?.classList.toggle('note-playing', add);
          }
        };
        swap(activeRef.current, false);
        swap(active, true);
        activeRef.current = active;

        if (active !== null) {
          const firstId = notes[active]?.ids[0];
          const el = firstId === undefined ? null : host.querySelector(`#${CSS.escape(firstId)}`);
          const scroller = scrollRef.current;
          if (el instanceof SVGElement && scroller !== null) {
            const er = el.getBoundingClientRect();
            const sr = scroller.getBoundingClientRect();
            if (er.top < sr.top + 40 || er.bottom > sr.bottom - 60) {
              const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
              scroller.scrollTo({
                top: scroller.scrollTop + (er.top - sr.top) - sr.height * 0.35,
                behavior: reduce ? 'auto' : 'smooth',
              });
            }
          }
        }
      }),
    [player],
  );

  return (
    <div className="rounded-[2px] bg-paper ring-1 ring-paper-edge">
      {status === 'loading' && (
        <p className="p-6 text-center text-sm text-confidence-mid">Engraving the score…</p>
      )}
      {status === 'error' && (
        <p className="p-6 text-center text-sm text-confidence-mid">
          The score could not load. Reload the page to try again.
        </p>
      )}
      <div ref={scrollRef} className="max-h-[420px] overflow-y-auto p-4">
        <div ref={hostRef} className="score-svg mx-auto w-fit [&_svg]:block" />
      </div>
    </div>
  );
}
