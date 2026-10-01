'use client';

/**
 * Lands finished recordings in the project: every take the engine reports
 * becomes an audio region on its track at the take's (latency-compensated)
 * start beat. Mounted once at the studio root so takes are never lost when
 * the mixer panel is closed. A take already in the project (same source,
 * placed by the transport's record path) is skipped, so each take lands once.
 */

import { useEffect } from 'react';
import type { DawEngine } from './engine';
import { audioRegionsOf, newAudioRegion, type DawProject } from './types';

export function useRecordingTakes(
  engine: DawEngine,
  update: (mutate: (draft: DawProject) => void) => void,
): void {
  useEffect(
    () =>
      engine.onRecordingComplete((take) =>
        update((draft) => {
          const track = draft.tracks.find((t) => t.id === take.trackId);
          if (!track) return;
          // The transport's record path may already have placed this take.
          if (audioRegionsOf(track).some((r) => r.source === take.source)) return;
          const lengthBeats = take.durationSec / (60 / draft.bpm);
          track.audioRegions = [
            ...audioRegionsOf(track),
            newAudioRegion(take.source, take.name, take.startBeat, lengthBeats),
          ];
        }),
      ),
    [engine, update],
  );
}
