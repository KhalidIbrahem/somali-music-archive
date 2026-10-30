/**
 * Quantized melody → MusicXML 4.0 (one part, one voice). The key signature is
 * the nearest major key that holds the fitted pentatonic set, so scale notes
 * need no accidentals. How far a note sat from the equal-tempered pitch is
 * written under it in cents when it is at least `centsThreshold` away; notes
 * outside the fitted scale are drawn in red. Both are measurements kept on
 * the page, not corrected away.
 */

import type { NotatedEvent, QuantizedScore } from './quantize';

export interface ScoreMeta {
  title: string;
  bpm: number;
  /** Fitted scale pitch classes (tonic first), or null when none was fitted. */
  scalePitchClasses: readonly number[] | null;
  /** One line printed above the first bar, e.g. the scale and tuning. */
  caption: string;
  showCents: boolean;
  centsThreshold?: number;
}

export const OFF_SCALE_COLOR = '#B3261E';

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const NATURAL: Record<(typeof LETTERS)[number], number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

/** Fifths (−6..6) of the major key nearest C that holds every pitch class. */
export function keyFifths(pitchClasses: readonly number[]): number {
  const order = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6];
  for (const f of order) {
    const tonic = (((7 * f) % 12) + 12) % 12;
    const diatonic = new Set(MAJOR.map((d) => (tonic + d) % 12));
    if (pitchClasses.every((pc) => diatonic.has(((pc % 12) + 12) % 12))) return f;
  }
  return 0;
}

function keyAlter(letter: string, fifths: number): number {
  if (fifths > 0 && SHARP_ORDER.slice(0, fifths).includes(letter)) return 1;
  if (fifths < 0 && FLAT_ORDER.slice(0, -fifths).includes(letter)) return -1;
  return 0;
}

export interface Spelled {
  step: string;
  alter: number;
  octave: number;
}

/** Spell a MIDI note in a key: diatonic names first, else sharps (sharp keys) or flats. */
export function spell(midi: number, fifths: number): Spelled {
  const pc = ((midi % 12) + 12) % 12;
  const prefer = fifths >= 0 ? [0, 1, -1] : [0, -1, 1];
  for (const shift of prefer) {
    for (const letter of LETTERS) {
      const alter = keyAlter(letter, fifths) + shift;
      if (Math.abs(alter) > 1) continue;
      if ((((NATURAL[letter] + alter) % 12) + 12) % 12 === pc) {
        return { step: letter, alter, octave: Math.floor((midi - alter) / 12) - 1 };
      }
    }
  }
  return { step: 'C', alter: 0, octave: Math.floor(midi / 12) - 1 };
}

const TYPE: Record<number, [string, boolean]> = {
  1: ['16th', false],
  2: ['eighth', false],
  3: ['eighth', true],
  4: ['quarter', false],
  6: ['quarter', true],
  8: ['half', false],
  12: ['half', true],
  16: ['whole', false],
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const ACCIDENTAL: Record<number, string> = { [-1]: 'flat', 0: 'natural', 1: 'sharp' };

function noteXml(
  ev: NotatedEvent,
  fifths: number,
  unitsPerBeat: number,
  state: Map<string, number>,
  meta: ScoreMeta,
): string {
  // Durations: divisions = unitsPerBeat per quarter (the beat is a quarter).
  const duration = ev.units;
  const [type, dotted] = TYPE[(ev.units * 4) / unitsPerBeat] ?? ['quarter', false];
  if (ev.midi === null) {
    if (ev.measureRest) {
      return `<note><rest measure="yes"/><duration>${duration}</duration><voice>1</voice></note>`;
    }
    return `<note><rest/><duration>${duration}</duration><voice>1</voice><type>${type}</type>${dotted ? '<dot/>' : ''}</note>`;
  }
  const p = spell(ev.midi, fifths);
  const key = `${p.step}${p.octave}`;
  const current = state.get(key) ?? keyAlter(p.step, fifths);
  let accidental = '';
  if (current !== p.alter) {
    state.set(key, p.alter);
    if (!ev.tieStop) accidental = `<accidental>${ACCIDENTAL[p.alter]}</accidental>`;
  }
  const ties =
    (ev.tieStop ? '<tie type="stop"/>' : '') + (ev.tieStart ? '<tie type="start"/>' : '');
  const tied =
    ev.tieStop || ev.tieStart
      ? `<notations>${ev.tieStop ? '<tied type="stop"/>' : ''}${ev.tieStart ? '<tied type="start"/>' : ''}</notations>`
      : '';
  const threshold = meta.centsThreshold ?? 15;
  const cents =
    meta.showCents && !ev.tieStop && Math.abs(ev.deviationCents) >= threshold
      ? `<lyric number="1"><syllabic>single</syllabic><text>${ev.deviationCents > 0 ? '+' : '−'}${Math.abs(ev.deviationCents)}</text></lyric>`
      : '';
  const color = ev.offScale ? ` color="${OFF_SCALE_COLOR}"` : '';
  const alter = p.alter !== 0 ? `<alter>${p.alter}</alter>` : '';
  return (
    `<note${color}><pitch><step>${p.step}</step>${alter}<octave>${p.octave}</octave></pitch>` +
    `<duration>${duration}</duration>${ties}<voice>1</voice><type>${type}</type>${dotted ? '<dot/>' : ''}` +
    `${accidental}${ev.offScale ? `<notehead color="${OFF_SCALE_COLOR}">normal</notehead>` : ''}${tied}${cents}</note>`
  );
}

export function toMusicXml(score: QuantizedScore, meta: ScoreMeta): string {
  const fifths = meta.scalePitchClasses ? keyFifths(meta.scalePitchClasses) : 0;
  const pitches = score.measures.flat().flatMap((e) => (e.midi === null ? [] : [e.midi]));
  const sortedPitches = [...pitches].sort((a, b) => a - b);
  const median = sortedPitches[Math.floor(sortedPitches.length / 2)] ?? 67;
  const clef =
    median >= 57
      ? '<clef><sign>G</sign><line>2</line></clef>'
      : '<clef><sign>F</sign><line>4</line></clef>';
  const bpm = Math.round(meta.bpm);
  const measures = score.measures.map((events, i) => {
    const state = new Map<string, number>();
    const head =
      i === 0
        ? `<attributes><divisions>${score.unitsPerBeat}</divisions><key><fifths>${fifths}</fifths></key>` +
          `<time><beats>${score.beatsPerBar}</beats><beat-type>4</beat-type></time>${clef}</attributes>` +
          `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${bpm}"/></direction>` +
          (meta.caption
            ? `<direction placement="above"><direction-type><words>${escapeXml(meta.caption)}</words></direction-type></direction>`
            : '')
        : '';
    const body = events.map((ev) => noteXml(ev, fifths, score.unitsPerBeat, state, meta)).join('');
    return `<measure number="${i + 1}">${head}${body}</measure>`;
  });
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n' +
    '<score-partwise version="4.0">' +
    `<work><work-title>${escapeXml(meta.title)}</work-title></work>` +
    '<identification><creator type="arranger">Qormada automatic transcription (qaraamigen.com)</creator>' +
    '<encoding><software>QaraamiGen Qormada</software></encoding></identification>' +
    '<part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>' +
    `<part id="P1">${measures.join('')}</part></score-partwise>\n`
  );
}
