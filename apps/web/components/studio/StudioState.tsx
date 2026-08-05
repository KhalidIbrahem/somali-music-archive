'use client';

/**
 * StudioState — shared studio context: the sample session (fetched once,
 * structurally validated), engraving zoom, and the selected note.
 *
 * Playback time deliberately does NOT live here: React state per animation
 * frame would re-render the world. The timeline clock (B1-05) hands time to
 * its consumers imperatively.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export interface SessionNote {
  /** MEI/SVG glyph ids — tied glyphs share one logical note. */
  ids: string[];
  /** Performance time, seconds (pipeline output — rubato preserved). */
  start: number;
  end: number;
  midi: number;
  confidence: number;
  snapped: boolean;
  marked: boolean;
}

export interface SessionMeta {
  title: string;
  instrument: string;
  tonic: string;
  degrees: number[];
  tuningOffsetCents: number;
  bpm: number;
  grid: string;
  nNotes: number;
  snapped: number;
  markedOutliers: number;
  meanConfidence: number;
  durationSec: number;
}

export interface SessionData {
  meta: SessionMeta;
  notes: SessionNote[];
}

export type SessionStatus = 'loading' | 'ready' | 'error';

export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;
export const ZOOM_STEP = 25;

interface StudioStateValue {
  session: SessionData | null;
  sessionStatus: SessionStatus;
  zoomPercent: number;
  zoomIn: () => void;
  zoomOut: () => void;
  selectedNote: number | null;
  setSelectedNote: (index: number | null) => void;
  /** §3 "Show certainty": graded confidence ink vs uniform black for export. */
  showCertainty: boolean;
  setShowCertainty: (on: boolean) => void;
}

const StudioContext = createContext<StudioStateValue | null>(null);

/** Structural check on the fixture — a malformed file becomes a designed error
 *  state, not a crash deep inside the canvas. */
function validateSession(raw: unknown): SessionData {
  const data = raw as SessionData;
  if (
    typeof data !== 'object' ||
    data === null ||
    typeof data.meta !== 'object' ||
    !Array.isArray(data.notes) ||
    data.notes.length === 0
  ) {
    throw new Error('session.json is not a session fixture');
  }
  if (data.meta.nNotes !== data.notes.length) {
    throw new Error(
      `session.json note count mismatch: meta ${data.meta.nNotes}, list ${data.notes.length}`,
    );
  }
  for (const n of data.notes) {
    if (!Array.isArray(n.ids) || n.ids.length === 0 || typeof n.start !== 'number') {
      throw new Error('session.json contains a malformed note');
    }
  }
  return data;
}

export function StudioProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [session, setSession] = useState<SessionData | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('loading');
  const [zoomPercent, setZoomPercent] = useState(100);
  const [selectedNote, setSelectedNote] = useState<number | null>(null);
  const [showCertainty, setShowCertainty] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/sample/session.json');
        if (!res.ok) throw new Error(`session fetch failed (${res.status})`);
        const data = validateSession(await res.json());
        if (!cancelled) {
          setSession(data);
          setSessionStatus('ready');
        }
      } catch (err) {
        console.error('[studio] session load failed:', err);
        if (!cancelled) setSessionStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const zoomIn = useCallback(() => setZoomPercent((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoomPercent((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP)), []);

  const value = useMemo<StudioStateValue>(
    () => ({
      session,
      sessionStatus,
      zoomPercent,
      zoomIn,
      zoomOut,
      selectedNote,
      setSelectedNote,
      showCertainty,
      setShowCertainty,
    }),
    [session, sessionStatus, zoomPercent, zoomIn, zoomOut, selectedNote, showCertainty],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioStateValue {
  const ctx = useContext(StudioContext);
  if (ctx === null) throw new Error('useStudio must be used inside <StudioProvider>');
  return ctx;
}
