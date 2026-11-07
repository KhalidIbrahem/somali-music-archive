/**
 * Record flow (Studio v3) — pure helpers behind the Record panel: arming one
 * track, listing the takes made in this browser, the elapsed bars·beats
 * readout, the input meter's dB → position mapping and the reason the record
 * button is blocked. No DOM, no engine; everything is tested in
 * __tests__/recordFlow.test.ts.
 */

import { audioRegionsOf, trackKind, type DawAudioRegion, type DawProject } from './types';

/** The input meter's scale (dBFS). */
export const RECORD_METER_MIN_DB = -60;
export const RECORD_METER_MAX_DB = 6;
/** Tick marks drawn on the input meter (dBFS). */
export const RECORD_METER_TICKS = [0, -6, -12, -24, -48] as const;
/** The clip light comes on above this peak (dBFS). */
export const RECORD_CLIP_DB = -1;
/** Peak-hold time, ms. */
export const RECORD_PEAK_HOLD_MS = 1500;

/** User audio kept in this browser's IndexedDB (recordings and imports). */
const IDB_SOURCE_PREFIX = 'idb:';

const EPS = 1e-6;

/** Arm `trackId` and disarm every other track (mutates a draft). */
export function armOnly(project: DawProject, trackId: string): void {
  for (const track of project.tracks) track.armed = track.id === trackId;
}

export interface RecordableTake {
  trackId: string;
  trackName: string;
  region: DawAudioRegion;
}

/**
 * The takes recorded or imported in this browser: idb-sourced audio regions on
 * audio tracks, newest first (higher start beat first, then name descending so
 * "Take 3" sorts above "Take 2").
 */
export function recordableTakes(project: DawProject): RecordableTake[] {
  const takes: RecordableTake[] = [];
  for (const track of project.tracks) {
    if (trackKind(track) !== 'audio') continue;
    for (const region of audioRegionsOf(track)) {
      if (!region.source.startsWith(IDB_SOURCE_PREFIX)) continue;
      takes.push({ trackId: track.id, trackName: track.name, region });
    }
  }
  return takes.sort(
    (a, b) =>
      b.region.startBeat - a.region.startBeat ||
      b.region.name.localeCompare(a.region.name, undefined, { numeric: true }),
  );
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/**
 * Elapsed recording time as completed bars and beats, "2 bars 3 beats" style.
 * The first beat counts from the downbeat, so the readout starts at
 * "0 bars 1 beat" and never reads zero; it is never negative (a count-in
 * before the start beat reads as the start).
 */
export function elapsedLabel(beat: number, startBeat: number, beatsPerBar: number): string {
  const perBar = Math.max(1, Math.floor(beatsPerBar));
  const elapsed = Math.max(0, beat - startBeat);
  const total = Math.max(1, Math.floor(elapsed + EPS));
  const bars = Math.floor(total / perBar);
  const beats = total % perBar;
  return `${plural(bars, 'bar')} ${plural(beats, 'beat')}`;
}

/** A level in dBFS as a 0…1 position on the meter (clamped; −∞ and NaN read 0). */
export function dbToMeterPos(
  db: number,
  minDb = RECORD_METER_MIN_DB,
  maxDb = RECORD_METER_MAX_DB,
): number {
  if (!Number.isFinite(db) || maxDb <= minDb) return db === Infinity ? 1 : 0;
  return Math.min(1, Math.max(0, (db - minDb) / (maxDb - minDb)));
}

/**
 * Why the record button is disabled, or null when a take can start: some
 * track is armed (audio or MIDI), or the selected track is an instrument
 * track (the studio arms it when Record is pressed).
 */
export function recordBlockedReason(
  project: DawProject,
  selectedTrackId: string | null,
): string | null {
  if (project.tracks.some((t) => t.armed)) return null;
  const selected = project.tracks.find((t) => t.id === selectedTrackId);
  if (selected && trackKind(selected) === 'midi') return null;
  return 'Arm a track to record into it';
}
