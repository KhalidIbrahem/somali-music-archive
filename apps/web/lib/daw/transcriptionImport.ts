/**
 * Transcription → MIDI track (Studio v2).
 *
 * Accepts the platform's transcription note list — the shape of
 * public/sample/session.json (`{ meta, notes: [{ start, end, midi,
 * confidence, … }] }`, times in seconds) — and a few looser variants a
 * pipeline might emit: a bare note array, times in beats
 * (`startBeat`/`lengthBeats` or `meta.unit: 'beats'`), `duration` instead of
 * `end`, pitch as `pitch` (MIDI number, note name like "A4", or Hz via
 * `hz`/`freq`), and an explicit `velocity`. Velocity falls back to the note's
 * confidence, so certain notes play louder than doubtful ones.
 */

import {
  newId,
  newRegion,
  newTrack,
  type DawNote,
  type DawProject,
  type DawRegion,
  type DawTrack,
  type InstrumentId,
} from './types';

export type TimeUnit = 'seconds' | 'beats';

/** A transcription note after normalisation (time unit as given). */
export interface TranscriptionNote {
  start: number;
  end: number;
  midi: number;
  /** 0–1. */
  velocity: number;
  /** Flagged as an outlier by the pipeline (kept unless the caller drops it). */
  marked: boolean;
}

export interface Transcription {
  title: string;
  unit: TimeUnit;
  /** The transcription's own tempo when it states one. */
  bpm: number | null;
  notes: TranscriptionNote[];
}

export class TranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

const NOTE_NAMES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DEFAULT_VELOCITY = 0.8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** "A4" → 69, "C#3" → 49, "Bb2" → 46. Returns null when not a note name. */
export function noteNameToMidi(name: string): number | null {
  const m = /^\s*([A-Ga-g])([#♯b♭]?)(-?\d+)\s*$/.exec(name);
  if (!m) return null;
  const letter = NOTE_NAMES[(m[1] ?? '').toUpperCase()];
  if (letter === undefined) return null;
  const accidental = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + letter + accidental;
}

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

function pitchOf(note: Record<string, unknown>): number | null {
  const direct = num(note['midi']);
  if (direct !== null) return direct;
  const pitch = note['pitch'];
  if (typeof pitch === 'number' && Number.isFinite(pitch)) return pitch;
  if (typeof pitch === 'string') return noteNameToMidi(pitch);
  const hz = num(note['hz']) ?? num(note['freq']) ?? num(note['frequency']);
  return hz !== null && hz > 0 ? hzToMidi(hz) : null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Normalise any supported transcription JSON. Throws TranscriptionError when it is not one. */
export function parseTranscription(raw: unknown): Transcription {
  const meta = isRecord(raw) && isRecord(raw['meta']) ? raw['meta'] : {};
  const list = Array.isArray(raw) ? raw : isRecord(raw) ? raw['notes'] : undefined;
  if (!Array.isArray(list)) throw new TranscriptionError('no "notes" list in this file');

  const metaUnit = meta['unit'];
  let unit: TimeUnit = metaUnit === 'beats' ? 'beats' : 'seconds';
  const first = list.find(isRecord);
  if (first && num(first['startBeat']) !== null) unit = 'beats';

  const notes: TranscriptionNote[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const start = num(item['startBeat']) ?? num(item['start']) ?? num(item['time']);
    const length =
      num(item['lengthBeats']) ??
      num(item['duration']) ??
      (num(item['end']) !== null && start !== null ? (num(item['end']) ?? 0) - start : null);
    const midi = pitchOf(item);
    if (start === null || length === null || midi === null || length <= 0) continue;
    const roundedMidi = Math.round(midi);
    if (roundedMidi < 0 || roundedMidi > 127) continue;
    const velocity = num(item['velocity']) ?? num(item['confidence']) ?? DEFAULT_VELOCITY;
    notes.push({
      start,
      end: start + length,
      midi: roundedMidi,
      // A velocity above 1 is MIDI-scaled (1–127).
      velocity: clamp01(velocity > 1 ? velocity / 127 : velocity),
      marked: item['marked'] === true,
    });
  }
  if (notes.length === 0) throw new TranscriptionError('the transcription has no usable notes');
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);

  const title =
    typeof meta['title'] === 'string' && meta['title'] ? meta['title'] : 'Transcription';
  const bpm = num(meta['bpm']);
  return { title, unit, bpm: bpm !== null && bpm > 0 ? bpm : null, notes };
}

export interface TranscriptionToRegionOptions {
  /** Project tempo — converts seconds to beats. */
  bpm: number;
  beatsPerBar: number;
  /** Timeline position of the region, beats. */
  startBeat?: number;
  /** Drop notes the pipeline marked as outliers. */
  skipMarked?: boolean;
  /** Shift so the first note lands at the region start (drops leading silence). */
  trimLeadingSilence?: boolean;
  /** Notes quieter than this (0–1) are lifted to it so low-confidence notes stay audible. */
  minVelocity?: number;
}

/** Convert a transcription into one MIDI region (beats at the project tempo). */
export function transcriptionToRegion(
  transcription: Transcription,
  options: TranscriptionToRegionOptions,
): DawRegion {
  const beatsPer = transcription.unit === 'beats' ? 1 : options.bpm / 60;
  const kept = transcription.notes.filter((n) => !(options.skipMarked && n.marked));
  const shift = options.trimLeadingSilence && kept.length > 0 ? (kept[0]?.start ?? 0) : 0;
  const minVelocity = options.minVelocity ?? 0.05;

  const notes: DawNote[] = kept.map((n) => ({
    id: newId('nt'),
    startBeat: Math.max(0, (n.start - shift) * beatsPer),
    lengthBeats: Math.max(1 / 64, (n.end - n.start) * beatsPer),
    midi: n.midi,
    velocity: Math.max(minVelocity, n.velocity),
  }));

  const bar = Math.max(1, options.beatsPerBar);
  const end = notes.reduce((max, n) => Math.max(max, n.startBeat + n.lengthBeats), 0);
  const region = newRegion(options.startBeat ?? 0, Math.max(bar, Math.ceil(end / bar) * bar));
  region.notes = notes;
  return region;
}

/** A new MIDI track holding the transcription, ready to push onto project.tracks. */
export function transcriptionToTrack(
  transcription: Transcription,
  project: Pick<DawProject, 'bpm' | 'timeSignature'>,
  instrument: InstrumentId,
  options: Omit<TranscriptionToRegionOptions, 'bpm' | 'beatsPerBar'> = {},
): DawTrack {
  const track = newTrack(transcription.title.slice(0, 80), instrument);
  track.regions = [
    transcriptionToRegion(transcription, {
      ...options,
      bpm: project.bpm,
      beatsPerBar: project.timeSignature.beatsPerBar,
    }),
  ];
  return track;
}

/** The studio's sample transcription (synthesised fixture, never archival audio). */
export const SAMPLE_TRANSCRIPTION_URL = '/sample/session.json';

export async function fetchSampleTranscription(): Promise<Transcription> {
  const res = await fetch(SAMPLE_TRANSCRIPTION_URL);
  if (!res.ok) throw new TranscriptionError(`sample transcription fetch failed (${res.status})`);
  return parseTranscription((await res.json()) as unknown);
}
