'use client';

/**
 * StepSequencer (Stage 5 Tier 1) — the durbaan editor: a 16-step grid over
 * the dum/tak/slap lanes, with the Somali groove presets (dhaanto, jiifto,
 * heello, banaadiri) one tap away. The grid is a VIEW over ordinary region
 * notes quantised to 16ths — the same data the piano roll and engine read.
 */

import { useMemo } from 'react';
import type { DawEngine } from '@/lib/daw/engine';
import { GROOVE_PRESETS, STEPS_PER_BAR, grooveToNotes } from '@/lib/daw/grooves';
import {
  DURBAAN_LANES,
  newId,
  type DawProject,
  type DawRegion,
  type DawTrack,
} from '@/lib/daw/types';

export function StepSequencer({
  project,
  track,
  region,
  engine,
  onUpdate,
}: {
  project: DawProject;
  track: DawTrack;
  region: DawRegion;
  engine: DawEngine;
  onUpdate: (mutate: (draft: DawProject) => void) => void;
}): React.JSX.Element {
  const beatsPerBar = project.timeSignature.beatsPerBar;
  const stepBeats = beatsPerBar / STEPS_PER_BAR;

  /** velocity per [lane][step] from the region's notes (first bar of content). */
  const grid = useMemo((): number[][] => {
    const lanes = DURBAAN_LANES.map(() => Array.from({ length: STEPS_PER_BAR }, () => 0));
    for (const note of region.notes) {
      const laneIndex = DURBAAN_LANES.findIndex((lane) => lane.midi === note.midi);
      if (laneIndex === -1) continue;
      const step = Math.round(note.startBeat / stepBeats);
      if (step >= 0 && step < STEPS_PER_BAR) {
        const lane = lanes[laneIndex];
        if (lane) lane[step] = note.velocity;
      }
    }
    return lanes;
  }, [region.notes, stepBeats]);

  const setStep = (laneIndex: number, step: number, velocity: number): void => {
    const midi = DURBAAN_LANES[laneIndex]?.midi ?? 36;
    onUpdate((draft) => {
      const r = draft.tracks
        .find((t) => t.id === track.id)
        ?.regions.find((x) => x.id === region.id);
      if (!r) return;
      r.notes = r.notes.filter(
        (n) => !(n.midi === midi && Math.round(n.startBeat / stepBeats) === step),
      );
      if (velocity > 0) {
        r.notes.push({
          id: newId('nt'),
          startBeat: step * stepBeats,
          lengthBeats: stepBeats,
          midi,
          velocity,
        });
      }
    });
    if (velocity > 0) engine.audition('durbaan', midi, velocity);
  };

  const applyPreset = (presetId: string): void => {
    const preset = GROOVE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    onUpdate((draft) => {
      const r = draft.tracks
        .find((t) => t.id === track.id)
        ?.regions.find((x) => x.id === region.id);
      if (!r) return;
      r.lengthBeats = beatsPerBar;
      r.notes = grooveToNotes(preset, beatsPerBar);
    });
  };

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="numeric text-[10px] tracking-[0.16em] text-low uppercase">
          Somali grooves
        </span>
        {GROOVE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => applyPreset(preset.id)}
            className="rounded-[4px] border border-hairline bg-chrome-2 px-3 py-1.5 text-xs text-mid transition-colors hover:border-accent-state hover:text-hi"
          >
            {preset.label}
          </button>
        ))}
        <span className="numeric ml-auto hidden text-[10px] text-low sm:block">
          tap = stroke · tap again = accent · third tap clears
        </span>
      </div>

      <div className="min-w-[560px]">
        {grid.map((lane, laneIndex) => (
          <div key={DURBAAN_LANES[laneIndex]?.midi} className="mb-1.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => engine.audition('durbaan', DURBAAN_LANES[laneIndex]?.midi ?? 36)}
              className="numeric w-12 shrink-0 text-left text-[11px] tracking-wide text-mid uppercase hover:text-accent-state"
            >
              {DURBAAN_LANES[laneIndex]?.label}
            </button>
            <div className="grid flex-1 grid-cols-16 gap-1">
              {lane.map((velocity, step) => {
                const level = velocity === 0 ? 0 : velocity < 0.6 ? 1 : velocity < 0.85 ? 2 : 3;
                return (
                  <button
                    key={step}
                    type="button"
                    aria-label={`${DURBAAN_LANES[laneIndex]?.label} step ${step + 1}`}
                    onClick={() => {
                      // cycle: off → normal → accent → off
                      const next = level === 0 ? 0.7 : level <= 2 && velocity < 0.85 ? 0.95 : 0;
                      setStep(laneIndex, step, next);
                    }}
                    className={`h-9 rounded-[3px] border transition-colors ${
                      step % 4 === 0 ? 'border-hairline' : 'border-hairline/50'
                    } ${
                      level === 0
                        ? 'bg-chrome-2 hover:bg-chrome-2/70'
                        : level < 3
                          ? 'bg-accent-state/55'
                          : 'bg-accent-state'
                    }`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="numeric text-[10px] text-low">
        one bar of {beatsPerBar} beats · 16 steps · region loops ×{region.loopCount}
      </p>
    </div>
  );
}
