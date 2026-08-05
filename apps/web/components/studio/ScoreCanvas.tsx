'use client';

/**
 * ScoreCanvas — Verovio engraving on the paper surface, bound to the shared
 * timeline (B1-03/05).
 *
 * Engraving: the toolkit (WASM) loads once per page and is cached at module
 * scope; the MEI loads once into it. Zoom re-engraves via setOptions +
 * redoLayout at a constant SVG pixel width — staves grow, the paper doesn't.
 * The first engrave is timed with performance.measure('engrave'); B1-03's
 * pass criterion is < 500ms.
 *
 * Timeline binding (§2, non-negotiable): clicking a note seeks the audio to
 * its onset (sample-accurate) and selects it (amber). During playback the
 * note under the cursor is highlighted (flag blue) and kept in view. Glyph
 * state lives in CSS classes applied imperatively — per-frame updates never
 * re-render React, and re-engraving re-applies the current state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VerovioToolkit } from 'verovio/esm';
import { useStudio } from './StudioState';
import { useTimeline } from './TimelineEngine';

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
    const wasmModule = await createVerovioModule();
    return { toolkit: new Toolkit(wasmModule), mei };
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
  const { zoomPercent, session, selectedNote, setSelectedNote } = useStudio();
  const engine = useTimeline();
  const [status, setStatus] = useState<CanvasStatus>('loading');
  const hostRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);
  const playingNoteRef = useRef<number | null>(null);
  const selectedNoteRef = useRef<number | null>(null);

  /** Any glyph id (tied glyphs included) → logical note index. */
  const idToIndex = useMemo(() => {
    const map = new Map<string, number>();
    session?.notes.forEach((note, i) => {
      for (const id of note.ids) map.set(id, i);
    });
    return map;
  }, [session]);

  const setGlyphState = useCallback(
    (index: number | null, cls: string, prevRef: { current: number | null }): void => {
      const host = hostRef.current;
      if (host === null || session === null) return;
      if (prevRef.current !== null && prevRef.current !== index) {
        const prev = session.notes[prevRef.current];
        if (prev !== undefined) {
          for (const id of prev.ids) {
            host.querySelector(`#${CSS.escape(id)}`)?.classList.remove(cls);
          }
        }
      }
      if (index !== null) {
        const note = session.notes[index];
        if (note !== undefined) {
          for (const id of note.ids) {
            host.querySelector(`#${CSS.escape(id)}`)?.classList.add(cls);
          }
        }
      }
      prevRef.current = index;
    },
    [session],
  );

  /** Scroll the active glyph into the canvas viewport if it left it. */
  const revealNote = useCallback(
    (index: number): void => {
      const host = hostRef.current;
      const firstId = session?.notes[index]?.ids[0];
      if (host === null || firstId === undefined) return;
      const el = host.querySelector(`#${CSS.escape(firstId)}`);
      const scroller = host.closest('[data-score-scroll]');
      if (!(el instanceof SVGElement) || !(scroller instanceof HTMLElement)) return;
      const er = el.getBoundingClientRect();
      const sr = scroller.getBoundingClientRect();
      if (er.top < sr.top + 64 || er.bottom > sr.bottom - 96) {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        scroller.scrollTo({
          top: scroller.scrollTop + (er.top - sr.top) - sr.height * 0.35,
          behavior: reduce ? 'auto' : 'smooth',
        });
      }
    },
    [session],
  );

  // ── engrave (and re-engrave on zoom) ───────────────────────────────────────
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
        // innerHTML replaced the glyphs — restore current cursor + selection.
        const playing = playingNoteRef.current;
        const selected = selectedNoteRef.current;
        playingNoteRef.current = null;
        selectedNoteRef.current = null;
        setGlyphState(selected, 'note-selected', selectedNoteRef);
        setGlyphState(playing, 'note-playing', playingNoteRef);
        setStatus('ready');
      } catch (err) {
        console.error('[studio] engraving failed:', err);
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [zoomPercent, setGlyphState]);

  // ── selection (amber) ──────────────────────────────────────────────────────
  useEffect(() => {
    setGlyphState(selectedNote, 'note-selected', selectedNoteRef);
  }, [selectedNote, setGlyphState]);

  // ── playback cursor (flag blue) ────────────────────────────────────────────
  useEffect(() => {
    if (session === null) return undefined;
    const starts = session.notes.map((n) => n.start);
    const findActive = (t: number): number | null => {
      let lo = 0;
      let hi = starts.length - 1;
      let idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if ((starts[mid] ?? Infinity) <= t) {
          idx = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (idx < 0) return null;
      const note = session.notes[idx];
      return note !== undefined && t < note.end ? idx : null;
    };
    return engine.onFrame((t) => {
      const active = findActive(t);
      if (active !== playingNoteRef.current) {
        setGlyphState(active, 'note-playing', playingNoteRef);
        if (active !== null) revealNote(active);
      }
    });
  }, [session, engine, setGlyphState, revealNote]);

  // ── click a note → seek + select (§2: bidirectional cursor) ───────────────
  const onCanvasClick = (e: React.MouseEvent): void => {
    if (session === null) return;
    const glyph = (e.target as Element).closest('g.note');
    if (glyph === null) return;
    const index = idToIndex.get(glyph.id);
    if (index === undefined) return;
    const note = session.notes[index];
    if (note === undefined) return;
    setSelectedNote(index);
    engine.seek(note.start);
  };

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
      <div
        ref={hostRef}
        onClick={onCanvasClick}
        className="score-svg mx-auto w-fit pb-8 [&_g.note]:cursor-pointer [&_svg]:block"
      />
    </div>
  );
}
