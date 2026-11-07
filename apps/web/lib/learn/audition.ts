/**
 * Timed auditions for the Learn panel (Studio v3). Lessons play scales,
 * grooves and the Beerdilaacshe phrases through engine.audition() on a
 * setTimeout schedule — good enough for listening and practice at lesson
 * speeds (the transport's sample-accurate scheduler is for the arrangement).
 * Every schedule returns a cancel function; callers cancel on unmount.
 */

import type { DawEngine } from '@/lib/daw/engine';
import type { InstrumentId } from '@/lib/daw/types';

export interface AuditionEvent {
  atMs: number;
  instrument: InstrumentId;
  midi: number;
  velocity: number;
}

export type Cancel = () => void;

export function scheduleAuditions(
  engine: DawEngine,
  events: readonly AuditionEvent[],
  onDone?: () => void,
  doneAfterMs?: number,
): Cancel {
  engine.unlock();
  const timers: number[] = [];
  let last = 0;
  for (const ev of events) {
    last = Math.max(last, ev.atMs);
    timers.push(
      window.setTimeout(
        () => engine.audition(ev.instrument, ev.midi, ev.velocity),
        Math.max(0, Math.round(ev.atMs)),
      ),
    );
  }
  if (onDone) timers.push(window.setTimeout(onDone, Math.round(doneAfterMs ?? last + 350)));
  return () => {
    for (const t of timers) window.clearTimeout(t);
  };
}

/** `beats` metronome clicks (durbaan tak) at `bpm`, starting now. */
export function countInEvents(bpm: number, beats: number, startMs = 0): AuditionEvent[] {
  const beatMs = 60000 / bpm;
  return Array.from({ length: beats }, (_, i) => ({
    atMs: startMs + i * beatMs,
    instrument: 'durbaan',
    midi: i === 0 ? 36 : 38,
    velocity: i === 0 ? 0.9 : 0.6,
  }));
}
