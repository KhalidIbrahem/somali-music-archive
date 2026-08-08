/**
 * DAW project types (Stage 5 Tier 1) — the plain-data document defined in
 * docs/DAW-PROJECT-FORMAT.md. All musical time is in BEATS. Everything is
 * JSON-serialisable; the UI edits this and the engine consumes it.
 */

export const DAW_FORMAT_VERSION = 1 as const;
export const BPM_MIN = 60;
export const BPM_MAX = 140;

export type InstrumentId = 'oud' | 'durbaan' | 'bass' | 'keys';

export type PentatonicMode =
  | 'major-pentatonic'
  | 'minor-pentatonic'
  | 'suspended-pentatonic'
  | 'blues-minor-pentatonic'
  | 'ritusen';

export interface DawNote {
  id: string;
  /** Relative to region start, in beats. */
  startBeat: number;
  lengthBeats: number;
  midi: number;
  /** 0–1. */
  velocity: number;
}

export interface DawRegion {
  id: string;
  kind: 'midi';
  startBeat: number;
  lengthBeats: number;
  /** ≥1 — total footprint on the timeline is lengthBeats * loopCount. */
  loopCount: number;
  notes: DawNote[];
}

export interface DawTrack {
  id: string;
  name: string;
  instrument: InstrumentId;
  gain: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  armed: boolean;
  regions: DawRegion[];
}

export interface DawProject {
  formatVersion: typeof DAW_FORMAT_VERSION;
  id: string;
  name: string;
  bpm: number;
  timeSignature: { beatsPerBar: number; beatUnit: number };
  scaleLock: { enabled: boolean; root: number; mode: PentatonicMode };
  loop: { enabled: boolean; startBeat: number; endBeat: number };
  metronome: { enabled: boolean; countInBars: 0 | 1 | 2 };
  masterGain: number;
  tracks: DawTrack[];
  updatedAt: string;
}

/** Durbaan lanes (General-MIDI-adjacent, fixed for the step grid). */
export const DURBAAN_LANES = [
  { midi: 36, label: 'Dum' },
  { midi: 38, label: 'Tak' },
  { midi: 42, label: 'Slap' },
] as const;

export const INSTRUMENT_LABELS: Record<InstrumentId, string> = {
  oud: 'Oud',
  durbaan: 'Durbaan',
  bass: 'Bass',
  keys: 'Keys',
};

let counter = 0;
/** Ids only need uniqueness within a project — short, readable, sortable. */
export function newId(prefix: string): string {
  counter = (counter + 1) % 46656;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

export function newProject(name: string): DawProject {
  return {
    formatVersion: DAW_FORMAT_VERSION,
    id: newId('proj'),
    name,
    bpm: 104,
    timeSignature: { beatsPerBar: 4, beatUnit: 4 },
    scaleLock: { enabled: true, root: 9, mode: 'minor-pentatonic' },
    loop: { enabled: false, startBeat: 0, endBeat: 8 },
    metronome: { enabled: true, countInBars: 1 },
    masterGain: 1,
    tracks: [
      newTrack('Oud', 'oud'),
      newTrack('Durbaan', 'durbaan'),
      newTrack('Bass', 'bass'),
      newTrack('Keys', 'keys'),
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function newTrack(name: string, instrument: InstrumentId): DawTrack {
  return {
    id: newId('trk'),
    name,
    instrument,
    gain: instrument === 'durbaan' ? 0.9 : 0.8,
    pan: 0,
    muted: false,
    solo: false,
    armed: false,
    regions: [],
  };
}

export function newRegion(startBeat: number, lengthBeats: number): DawRegion {
  return { id: newId('rgn'), kind: 'midi', startBeat, lengthBeats, loopCount: 1, notes: [] };
}

/** Beats where the project's content ends (≥ one bar so empty projects play). */
export function projectEndBeat(project: DawProject): number {
  let end = project.timeSignature.beatsPerBar;
  for (const track of project.tracks) {
    for (const region of track.regions) {
      end = Math.max(end, region.startBeat + region.lengthBeats * region.loopCount);
    }
  }
  return end;
}

/** Deep-clone the plain document (history/undo seam for later tiers). */
export function cloneProject(project: DawProject): DawProject {
  return JSON.parse(JSON.stringify(project)) as DawProject;
}
