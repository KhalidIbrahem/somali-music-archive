/**
 * Somali rhythm presets (Stage 5 Tier 1) — one-bar, 16-step durbaan patterns
 * on the dum/tak/slap lanes, named after the rhythmic families the master
 * plan calls for. Stylised, editable starting points (the step grid is the
 * editor of record) — the heello preset is the exact groove the Beerdilaacshe
 * engine has always played (dum · tak · ghost-tak · dum · tak).
 */

import { DURBAAN_LANES, newRegion, type DawNote, type DawRegion } from './types';
import { newId } from './types';

export interface GroovePreset {
  id: string;
  label: string;
  /** [dum, tak, slap] — 16 steps per lane, velocity 0 = silent. */
  lanes: readonly [readonly number[], readonly number[], readonly number[]];
}

const _ = 0;

export const GROOVE_PRESETS: readonly GroovePreset[] = [
  {
    id: 'heello',
    label: 'Heello',
    lanes: [
      [0.95, _, _, _, _, _, _, _, 0.7, _, _, _, _, _, _, _],
      [_, _, _, _, 0.7, _, _, 0.3, _, _, _, _, 0.7, _, _, _],
      [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    ],
  },
  {
    id: 'dhaanto',
    label: 'Dhaanto',
    lanes: [
      [0.95, _, _, 0.75, _, _, 0.85, _, _, _, 0.6, _, _, _, _, _],
      [_, _, _, _, _, _, _, _, 0.75, _, _, 0.6, _, _, 0.75, _],
      [_, _, _, _, 0.35, _, _, _, _, _, _, _, 0.35, _, _, _],
    ],
  },
  {
    id: 'jiifto',
    label: 'Jiifto',
    lanes: [
      [0.95, _, _, _, _, _, _, 0.7, _, _, _, _, _, _, _, _],
      [_, _, _, _, 0.7, _, _, _, _, _, _, _, 0.7, _, _, _],
      [_, _, _, _, _, _, _, _, _, _, 0.35, _, _, _, _, _],
    ],
  },
  {
    id: 'banaadiri',
    label: 'Banaadiri',
    lanes: [
      [0.95, _, _, _, _, _, 0.7, _, 0.8, _, _, _, _, _, _, _],
      [_, _, 0.6, _, 0.75, _, _, _, _, _, 0.6, _, 0.75, _, 0.5, _],
      [_, _, _, _, _, _, _, 0.35, _, _, _, _, _, _, _, 0.35],
    ],
  },
];

/** Steps per bar in the grid (16ths in 4/4). */
export const STEPS_PER_BAR = 16;

/** Convert a preset into region notes for a `beatsPerBar`-beat bar. */
export function grooveToNotes(preset: GroovePreset, beatsPerBar: number): DawNote[] {
  const stepBeats = beatsPerBar / STEPS_PER_BAR;
  const notes: DawNote[] = [];
  preset.lanes.forEach((lane, laneIndex) => {
    lane.forEach((velocity, step) => {
      if (velocity <= 0) return;
      notes.push({
        id: newId('nt'),
        startBeat: step * stepBeats,
        lengthBeats: stepBeats,
        midi: DURBAAN_LANES[laneIndex]?.midi ?? 36,
        velocity,
      });
    });
  });
  return notes;
}

/** A one-bar looped region carrying a groove preset. */
export function grooveRegion(
  preset: GroovePreset,
  startBeat: number,
  beatsPerBar: number,
  bars: number,
): DawRegion {
  const region = newRegion(startBeat, beatsPerBar);
  region.loopCount = Math.max(1, bars);
  region.notes = grooveToNotes(preset, beatsPerBar);
  return region;
}
