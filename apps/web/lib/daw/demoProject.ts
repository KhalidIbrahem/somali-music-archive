/**
 * The Beerdilaacshe demo project (Stage 5 Tier 1) — the studio opens with the
 * songbook's first melody already arranged: the engraved score's 126 notes on
 * the oud track and the heello durbaan groove underneath, exactly the pairing
 * the score page performs. Built from the same notes.json the whole platform
 * shares.
 */

import type { ScoreData } from '@/lib/audio/qaraamiEngine';
import { GROOVE_PRESETS, grooveRegion } from './grooves';
import { newId, newProject, newRegion, type DawProject } from './types';

export const DEMO_PROJECT_NAME = 'Beerdilaacshe (demo)';

export async function buildDemoProject(): Promise<DawProject> {
  const res = await fetch('/scores/beerdilaacshe/notes.json');
  if (!res.ok) throw new Error(`notes fetch failed (${res.status})`);
  const score = (await res.json()) as ScoreData;

  const project = newProject(DEMO_PROJECT_NAME);
  project.bpm = Math.min(140, Math.max(60, Math.round(score.bpm)));
  project.scaleLock = { enabled: true, root: 9, mode: 'minor-pentatonic' }; // A, the score's tonic family
  project.metronome = { enabled: false, countInBars: 1 };

  const beatsPerSec = project.bpm / 60;
  const melodyBeats = score.durationSec * beatsPerSec;
  const beatsPerBar = project.timeSignature.beatsPerBar;
  const lengthBeats = Math.ceil(melodyBeats / beatsPerBar) * beatsPerBar;

  const oud = project.tracks.find((t) => t.instrument === 'oud');
  if (oud) {
    const region = newRegion(0, lengthBeats);
    region.notes = score.notes.map((note) => ({
      id: newId('nt'),
      startBeat: note.start * beatsPerSec,
      lengthBeats: Math.max(0.1, (note.end - note.start) * beatsPerSec),
      midi: note.midi,
      velocity: note.velocity,
    }));
    oud.regions = [region];
  }

  const durbaan = project.tracks.find((t) => t.instrument === 'durbaan');
  const heello = GROOVE_PRESETS.find((g) => g.id === 'heello') ?? GROOVE_PRESETS[0];
  if (durbaan && heello) {
    durbaan.regions = [grooveRegion(heello, 0, beatsPerBar, lengthBeats / beatsPerBar)];
    durbaan.gain = 0.55; // well under the melody, like the score page mix
  }

  project.updatedAt = new Date().toISOString();
  return project;
}
