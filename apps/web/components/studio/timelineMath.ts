/**
 * The studio's one time axis (B1-04/05). Every surface that positions
 * something in time — waveform peaks, ruler ticks, the playhead, click-to-seek
 * — goes through these two linear maps over the same view window. Alignment
 * between surfaces is therefore exact by construction, not by tuning.
 */

/** The visible slice of the timeline, in seconds. */
export interface TimeView {
  start: number;
  duration: number;
}

export function timeToX(t: number, view: TimeView, width: number): number {
  return ((t - view.start) / view.duration) * width;
}

export function xToTime(x: number, view: TimeView, width: number): number {
  return view.start + (x / width) * view.duration;
}

/** Clamp a candidate view inside [0, total]; window no smaller than minDur. */
export function clampView(view: TimeView, total: number, minDur = 2): TimeView {
  const duration = Math.min(total, Math.max(minDur, view.duration));
  const start = Math.min(total - duration, Math.max(0, view.start));
  return { start, duration };
}

/** Ruler tick step so labels stay at least ~minPx apart. */
export function tickStep(view: TimeView, width: number, minPx = 72): number {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const perPx = view.duration / width;
  for (const s of steps) {
    if (s / perPx >= minPx) return s;
  }
  return steps[steps.length - 1] ?? 600;
}
