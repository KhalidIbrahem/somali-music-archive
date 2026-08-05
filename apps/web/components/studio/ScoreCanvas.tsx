'use client';

/**
 * ScoreCanvas — Verovio engraving on the paper surface, bound to the shared
 * timeline, carrying the confidence layer (B1-03/05/06).
 *
 * Engraving: the toolkit (WASM) loads once per page and is cached at module
 * scope; the MEI loads once into it. Zoom re-engraves via setOptions +
 * redoLayout at a constant SVG pixel width. First engrave is timed with
 * performance.measure('engrave') (<500ms criterion).
 *
 * Timeline binding (§2): clicking (or Enter/Space on) a note seeks the audio
 * to its onset and selects it (amber); during playback the note under the
 * cursor is flag blue and kept in view.
 *
 * Confidence layer (§3): each glyph's fill-opacity is its confidence tier's
 * ink alpha, applied imperatively after engraving — the "Show certainty"
 * toggle just rewrites style properties on live DOM, so switching cannot
 * flicker. Hover or focus opens a popover with pitch, confidence %, onset/
 * offset, and segment playback. Glyphs are focusable so the popover and
 * seek work without a mouse (§6 floor).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VerovioToolkit } from 'verovio/esm';
import { confidenceAlpha } from '@sma/constants';
import { useStudio } from './StudioState';
import { useTimeline } from './TimelineEngine';
import { formatClock, midiToHz, midiToName } from './format';

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

interface PopoverState {
  index: number;
  /** Glyph geometry relative to the canvas container. */
  centerX: number;
  top: number;
  bottom: number;
}

export function ScoreCanvas(): React.JSX.Element {
  const { zoomPercent, session, selectedNote, setSelectedNote, showCertainty } = useStudio();
  const engine = useTimeline();
  const [status, setStatus] = useState<CanvasStatus>('loading');
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);
  const playingNoteRef = useRef<number | null>(null);
  const selectedNoteRef = useRef<number | null>(null);
  const showCertaintyRef = useRef(showCertainty);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Any glyph id (tied glyphs included) → logical note index. */
  const idToIndex = useMemo(() => {
    const map = new Map<string, number>();
    session?.notes.forEach((note, i) => {
      for (const id of note.ids) map.set(id, i);
    });
    return map;
  }, [session]);

  /** §3: ink opacity = confidence tier alpha (or uniform when toggled off),
   *  plus the accessibility attributes that make glyphs focusable buttons. */
  const applyConfidenceInk = useCallback((): void => {
    const host = hostRef.current;
    if (host === null || session === null) return;
    session.notes.forEach((note, i) => {
      const alpha = showCertaintyRef.current ? confidenceAlpha(note.confidence) : 1;
      for (const id of note.ids) {
        const el = host.querySelector(`#${CSS.escape(id)}`);
        if (el instanceof SVGElement) {
          el.style.fillOpacity = String(alpha);
          el.setAttribute('tabindex', '0');
          el.setAttribute('role', 'button');
          el.setAttribute(
            'aria-label',
            `Note ${midiToName(note.midi)}, confidence ${Math.round(note.confidence * 100)}%`,
          );
          el.setAttribute('data-note-index', String(i));
        }
      }
    });
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
        // innerHTML replaced the glyphs — restore ink, cursor, and selection.
        applyConfidenceInk();
        const playing = playingNoteRef.current;
        const selected = selectedNoteRef.current;
        playingNoteRef.current = null;
        selectedNoteRef.current = null;
        setGlyphState(selected, 'note-selected', selectedNoteRef);
        setGlyphState(playing, 'note-playing', playingNoteRef);
        setPopover(null);
        setStatus('ready');
      } catch (err) {
        console.error('[studio] engraving failed:', err);
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [zoomPercent, setGlyphState, applyConfidenceInk]);

  // ── "Show certainty" — restyle live DOM only, never re-engrave (§3) ───────
  useEffect(() => {
    showCertaintyRef.current = showCertainty;
    applyConfidenceInk();
  }, [showCertainty, applyConfidenceInk]);

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

  // ── popover show/hide ──────────────────────────────────────────────────────
  const cancelHide = useCallback((): void => {
    if (hideTimerRef.current !== null) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);
  const scheduleHide = useCallback((): void => {
    cancelHide();
    hideTimerRef.current = setTimeout(() => setPopover(null), 150);
  }, [cancelHide]);

  const showPopoverFor = useCallback(
    (glyph: Element): void => {
      const container = containerRef.current;
      const index = idToIndex.get(glyph.id);
      if (container === null || index === undefined) return;
      cancelHide();
      const gr = glyph.getBoundingClientRect();
      const cr = container.getBoundingClientRect();
      setPopover({
        index,
        centerX: gr.left - cr.left + gr.width / 2,
        top: gr.top - cr.top,
        bottom: gr.bottom - cr.top,
      });
    },
    [idToIndex, cancelHide],
  );

  const glyphFromEvent = (e: { target: EventTarget | null }): Element | null =>
    e.target instanceof Element ? e.target.closest('g.note') : null;

  const seekToNote = useCallback(
    (index: number): void => {
      const note = session?.notes[index];
      if (note === undefined) return;
      setSelectedNote(index);
      engine.seek(note.start);
    },
    [session, setSelectedNote, engine],
  );

  const popoverNote = popover === null ? undefined : session?.notes[popover.index];
  const popoverBelow = popover !== null && popover.top < 104;

  return (
    <div ref={containerRef} className="relative">
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
        onClick={(e) => {
          const glyph = glyphFromEvent(e);
          if (glyph === null) return;
          const index = idToIndex.get(glyph.id);
          if (index !== undefined) seekToNote(index);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          const glyph = glyphFromEvent(e);
          if (glyph === null) return;
          e.preventDefault();
          const index = idToIndex.get(glyph.id);
          if (index !== undefined) seekToNote(index);
        }}
        onPointerOver={(e) => {
          const glyph = glyphFromEvent(e);
          if (glyph !== null) showPopoverFor(glyph);
        }}
        onPointerOut={(e) => {
          if (glyphFromEvent(e) !== null) scheduleHide();
        }}
        onFocus={(e) => {
          const glyph = glyphFromEvent(e);
          if (glyph !== null) showPopoverFor(glyph);
        }}
        onBlur={(e) => {
          if (glyphFromEvent(e) !== null) scheduleHide();
        }}
        className="score-svg mx-auto w-fit pb-8 [&_g.note]:cursor-pointer [&_svg]:block"
      />

      {popover !== null && popoverNote !== undefined && session !== null && (
        <div
          role="dialog"
          aria-label="Note detail"
          onPointerEnter={cancelHide}
          onPointerLeave={scheduleHide}
          className={`absolute z-20 w-56 -translate-x-1/2 rounded-[4px] border border-hairline bg-chrome-2 p-3 shadow-xl ${
            popoverBelow ? 'mt-2' : '-mt-2 -translate-y-full'
          }`}
          style={{
            left: popover.centerX,
            top: popoverBelow ? popover.bottom : popover.top,
          }}
        >
          <p className="text-[13px] font-semibold text-hi">
            {midiToName(popoverNote.midi)}{' '}
            <span className="numeric font-normal text-mid">
              {midiToHz(popoverNote.midi, session.meta.tuningOffsetCents)} Hz
            </span>
          </p>
          <p className="numeric mt-1 text-xs text-mid">
            Confidence {Math.round(popoverNote.confidence * 100)}%
          </p>
          <p className="numeric mt-1 text-[11px] text-low">
            {formatClock(popoverNote.start)} – {formatClock(popoverNote.end)}
          </p>
          <button
            type="button"
            onClick={() => void engine.playSegment(popoverNote.start, popoverNote.end)}
            className="mt-2 flex h-6 items-center gap-2 rounded-[4px] border border-hairline bg-chrome-1 px-2 text-xs text-hi transition-colors hover:border-accent-live focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-live"
          >
            <svg width="8" height="8" viewBox="0 0 12 12" fill="var(--accent-live)" aria-hidden>
              <path d="M2.5 1.2v9.6L11 6 2.5 1.2Z" />
            </svg>
            Play this note
          </button>
        </div>
      )}
    </div>
  );
}
