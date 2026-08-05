/**
 * Score-reader timeline math (B1-08). Pure functions so the auto-scroll
 * behaviour is unit-testable without a device: which note is under the
 * cursor, and where the list must scroll to keep it in view.
 */

export interface ReaderNote {
  start: number;
  end: number;
  /** 0-based page index. */
  page: number;
  /** Notehead y within its page, px at zoom 1. */
  y: number;
  confidence: number;
}

/** The note sounding at time t, or null in a gap (notes sorted by start). */
export function activeNoteAt(notes: readonly ReaderNote[], t: number): number | null {
  let lo = 0;
  let hi = notes.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((notes[mid]?.start ?? Infinity) <= t) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx < 0) return null;
  const note = notes[idx];
  return note !== undefined && t < note.end ? idx : null;
}

/** Absolute y of the note in list coordinates (pages stacked with a gap). */
export function absoluteNoteY(
  note: ReaderNote,
  pageHeight: number,
  pageGap: number,
  zoom: number,
): number {
  return (note.page * (pageHeight + pageGap) + note.y) * zoom;
}

/** Scroll offset that puts the sounding note ~35% down the viewport. */
export function followOffset(
  note: ReaderNote,
  pageHeight: number,
  pageGap: number,
  zoom: number,
  viewportHeight: number,
): number {
  return Math.max(0, absoluteNoteY(note, pageHeight, pageGap, zoom) - viewportHeight * 0.35);
}
