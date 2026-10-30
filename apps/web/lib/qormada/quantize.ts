/**
 * Measured notes (seconds) → measures of notatable durations on a sixteenth
 * grid. One melodic line: overlaps are trimmed, gaps become rests, notes that
 * cross a barline or need two values are split and tied, and values inside a
 * beat never cross the beat, so the rhythm reads the way a musician writes it.
 */

export interface TimedNote {
  start: number;
  end: number;
  midi: number;
  deviationCents: number;
  offScale: boolean;
  confidence: number;
}

export interface QuantizeOptions {
  bpm: number;
  /** A beat time in seconds (from the tempo estimate); bars start on a beat. */
  phaseSec: number;
  beatsPerBar: number;
  /** Grid steps per beat; 4 = sixteenth notes. */
  unitsPerBeat?: number;
  /** Gaps up to this many grid steps extend the previous note (legato); 0 = off. */
  fillGaps?: number;
}

export interface NotatedEvent {
  /** null = rest. */
  midi: number | null;
  units: number;
  tieStart: boolean;
  tieStop: boolean;
  /** A rest that fills its whole bar. */
  measureRest: boolean;
  deviationCents: number;
  offScale: boolean;
}

export interface QuantizedScore {
  measures: NotatedEvent[][];
  unitsPerBeat: number;
  beatsPerBar: number;
  /** Notes dropped because another note already held their grid step. */
  dropped: number;
}

interface GridNote {
  s: number;
  e: number;
  note: TimedNote;
}

const VALUES = [16, 12, 8, 6, 4, 3, 2, 1];

/**
 * Split `len` steps starting at bar position `pos` into readable values.
 * Inside a beat a value never crosses the beat; a value of a beat or more
 * starts on a beat, and in even meters a value of two beats or more, or a
 * dotted quarter, starts on beat 1 or 3. Rests use plain (undotted) values.
 */
export function decompose(
  pos: number,
  len: number,
  unitsPerBeat = 4,
  { beatsPerBar = 4, rest = false }: { beatsPerBar?: number; rest?: boolean } = {},
): number[] {
  const parts: number[] = [];
  let p = pos;
  let left = len;
  const evenMeter = beatsPerBar % 2 === 0;
  while (left > 0) {
    let take = 1;
    for (const d of VALUES) {
      if (d > left) continue;
      if (rest && (d === 3 || d === 6 || d === 12)) continue;
      const inBeat = p % unitsPerBeat;
      const needsStrong = d >= 2 * unitsPerBeat || d === (3 * unitsPerBeat) / 2;
      const strong = !evenMeter || !needsStrong || p % (2 * unitsPerBeat) === 0;
      if (d >= unitsPerBeat ? inBeat === 0 && strong : inBeat + d <= unitsPerBeat) {
        take = d;
        break;
      }
    }
    parts.push(take);
    p += take;
    left -= take;
  }
  return parts;
}

export function quantize(
  notes: readonly TimedNote[],
  { bpm, phaseSec, beatsPerBar, unitsPerBeat = 4, fillGaps = 0 }: QuantizeOptions,
): QuantizedScore {
  const barUnits = beatsPerBar * unitsPerBeat;
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  if (sorted.length === 0) return { measures: [], unitsPerBeat, beatsPerBar, dropped: 0 };
  const beatSec = 60 / bpm;
  const unitSec = beatSec / unitsPerBeat;
  const first = sorted[0]!;
  const origin = phaseSec + Math.floor((first.start + unitSec / 2 - phaseSec) / beatSec) * beatSec;

  const placed: GridNote[] = [];
  let dropped = 0;
  for (const note of sorted) {
    const s = Math.max(0, Math.round((note.start - origin) / unitSec));
    const e = Math.max(s + 1, Math.round((note.end - origin) / unitSec));
    const prev = placed[placed.length - 1];
    if (prev && s <= prev.s) {
      // Same grid step: keep the longer of the two.
      if (e - s > prev.e - prev.s) placed[placed.length - 1] = { s: prev.s, e, note };
      dropped++;
      continue;
    }
    if (prev && s < prev.e) prev.e = s;
    placed.push({ s, e, note });
  }

  for (let i = 0; i + 1 < placed.length; i++) {
    const gap = placed[i + 1]!.s - placed[i]!.e;
    if (gap > 0 && gap <= fillGaps) placed[i]!.e = placed[i + 1]!.s;
  }

  const total = Math.ceil(placed[placed.length - 1]!.e / barUnits) * barUnits;
  const spans: Array<{ s: number; e: number; note: TimedNote | null }> = [];
  let cursor = 0;
  for (const g of placed) {
    if (g.s > cursor) spans.push({ s: cursor, e: g.s, note: null });
    spans.push(g);
    cursor = g.e;
  }
  if (cursor < total) spans.push({ s: cursor, e: total, note: null });

  const measures: NotatedEvent[][] = Array.from({ length: total / barUnits }, () => []);
  for (const span of spans) {
    const pieces: Array<{ bar: number; pos: number; units: number }> = [];
    let at = span.s;
    while (at < span.e) {
      const bar = Math.floor(at / barUnits);
      const pos = at % barUnits;
      const room = Math.min(span.e - at, barUnits - pos);
      if (span.note === null && pos === 0 && room === barUnits) {
        pieces.push({ bar, pos, units: barUnits });
      } else {
        let p = pos;
        for (const units of decompose(pos, room, unitsPerBeat, {
          beatsPerBar,
          rest: span.note === null,
        })) {
          pieces.push({ bar, pos: p, units });
          p += units;
        }
      }
      at += room;
    }
    pieces.forEach((piece, i) => {
      const n = span.note;
      measures[piece.bar]!.push({
        midi: n ? n.midi : null,
        units: piece.units,
        tieStart: n !== null && i < pieces.length - 1,
        tieStop: n !== null && i > 0,
        measureRest: n === null && piece.units === barUnits,
        deviationCents: n ? n.deviationCents : 0,
        offScale: n ? n.offScale : false,
      });
    });
  }
  return { measures, unitsPerBeat, beatsPerBar, dropped };
}
