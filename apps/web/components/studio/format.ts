/**
 * Studio numeric formatting. Fixed-width output — these strings render in the
 * mono `numeric` utility and must never change length as values tick (§1).
 */

const pad = (n: number, w: number): string => String(n).padStart(w, '0');

/** 00:01:24.320 — playhead position. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(sec, 2)}.${pad(ms, 3)}`;
}

/** 00:05:49 — durations. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${pad(Math.floor(s / 3600), 2)}:${pad(Math.floor((s % 3600) / 60), 2)}:${pad(s % 60, 2)}`;
}

const PITCH_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const;

/** MIDI 52 → "E3". */
export function midiToName(midi: number): string {
  const name = PITCH_NAMES[((midi % 12) + 12) % 12] ?? 'C';
  return `${name}${Math.floor(midi / 12) - 1}`;
}

/** MIDI (+ global tuning offset) → Hz, one decimal. */
export function midiToHz(midi: number, tuningOffsetCents = 0): number {
  return Math.round(440 * Math.pow(2, (midi - 69) / 12 + tuningOffsetCents / 1200) * 10) / 10;
}
