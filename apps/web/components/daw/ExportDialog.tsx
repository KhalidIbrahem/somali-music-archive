'use client';

/**
 * ExportDialog (Studio v2) — everything that leaves the studio as a file:
 *  • full mix WAV (engine.renderMix when the engine has it, else the Tier-1
 *    renderMixdown of the MIDI voices);
 *  • stems — one WAV per track, downloaded one after another (no zip);
 *  • MIDI — the project's MIDI tracks as a format-1 .mid;
 *  • project JSON — a backup of the plain document, and its import.
 * All rendering happens in the browser; nothing is uploaded.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { DawEngine } from '@/lib/daw/engine';
import { engineRendersAudio, renderProject } from '@/lib/daw/loops';
import { projectToMidi } from '@/lib/daw/midi';
import {
  PROJECT_FILE_EXTENSION,
  parseProjectJson,
  projectFileName,
  projectToJson,
  replaceProject,
} from '@/lib/daw/projectFile';
import { audioRegionsOf, trackKind, type DawProject, type DawTrack } from '@/lib/daw/types';
import { audioBufferToWav, downloadBlob } from '@/lib/daw/wav';

const STEM_GAP_MS = 700;

function hasContent(track: DawTrack): boolean {
  return trackKind(track) === 'audio'
    ? audioRegionsOf(track).length > 0
    : track.regions.some((r) => r.notes.length > 0);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ExportDialog({
  project,
  engine,
  onUpdate,
  onClose,
}: {
  project: DawProject;
  engine: DawEngine;
  onUpdate: (mutate: (draft: DawProject) => void) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const titleId = useId();
  const firstButton = useRef<HTMLButtonElement | null>(null);
  const importInput = useRef<HTMLInputElement | null>(null);

  const rendersAudio = engineRendersAudio(engine);
  const stemTracks = project.tracks.filter(
    (t) => hasContent(t) && (rendersAudio || trackKind(t) === 'midi'),
  );
  const midiTracks = project.tracks.filter(
    (t) => trackKind(t) === 'midi' && t.regions.some((r) => r.notes.length > 0),
  );

  useEffect(() => {
    firstButton.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const run = useCallback(async (task: () => Promise<string>): Promise<void> => {
    setBusy(true);
    try {
      setStatus(await task());
    } catch (error) {
      setStatus(`Export failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const exportMix = (): void => {
    void run(async () => {
      setStatus('Rendering the mix…');
      const buffer = await renderProject(engine, project);
      downloadBlob(audioBufferToWav(buffer), projectFileName(project, '.wav'));
      return 'Mix exported as WAV.';
    });
  };

  const exportStems = (): void => {
    void run(async () => {
      let done = 0;
      for (const track of stemTracks) {
        setStatus(`Rendering stem ${done + 1} of ${stemTracks.length}: ${track.name}…`);
        const buffer = await renderProject(engine, project, [track.id]);
        downloadBlob(
          audioBufferToWav(buffer),
          projectFileName(
            { name: `${project.name}-${String(done + 1).padStart(2, '0')}-${track.name}` },
            '.wav',
          ),
        );
        done += 1;
        // Browsers throttle bursts of downloads; space them out.
        if (done < stemTracks.length) await wait(STEM_GAP_MS);
      }
      return `${done} stem${done === 1 ? '' : 's'} exported. If your browser asks, allow multiple downloads.`;
    });
  };

  const exportMidi = (): void => {
    void run(async () => {
      const bytes = projectToMidi(project);
      const copy = new Uint8Array(bytes.length);
      copy.set(bytes);
      downloadBlob(
        new Blob([copy.buffer], { type: 'audio/midi' }),
        projectFileName(project, '.mid'),
      );
      return `MIDI exported (${midiTracks.length} track${midiTracks.length === 1 ? '' : 's'}).`;
    });
  };

  const exportJson = (): void => {
    void run(async () => {
      downloadBlob(
        new Blob([projectToJson(project)], { type: 'application/json' }),
        projectFileName(project, PROJECT_FILE_EXTENSION),
      );
      return 'Project backup saved.';
    });
  };

  const importJson = (file: File): void => {
    void run(async () => {
      const { project: incoming, droppedAudioRegions } = parseProjectJson(await file.text());
      engine.stop();
      onUpdate((draft) => replaceProject(draft, incoming));
      return droppedAudioRegions > 0
        ? `Opened “${incoming.name}” as a new project; ${droppedAudioRegions} audio clip${droppedAudioRegions === 1 ? '' : 's'} with an unavailable source were left out.`
        : `Opened “${incoming.name}” as a new project.`;
    });
  };

  const actionClass =
    'flex w-full flex-col items-start rounded-[4px] border border-hairline bg-chrome-2 px-3 py-2 text-left transition-colors hover:border-accent-state disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="max-h-[85vh] w-full max-w-md overflow-auto rounded-[4px] border border-hairline bg-chrome-1 p-4">
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="font-display text-xl text-hi">
            Export
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-sm text-low hover:text-hi disabled:opacity-50"
          >
            Close
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <button
            ref={firstButton}
            type="button"
            disabled={busy}
            onClick={exportMix}
            className={actionClass}
          >
            <span className="text-sm text-hi">Full mix (WAV)</span>
            <span className="text-[11px] text-low">
              Stereo 44.1 kHz, 16-bit
              {rendersAudio ? '' : ' — MIDI instruments only in this build'}
            </span>
          </button>
          <button
            type="button"
            disabled={busy || stemTracks.length === 0}
            onClick={exportStems}
            className={actionClass}
          >
            <span className="text-sm text-hi">Stems (one WAV per track)</span>
            <span className="text-[11px] text-low">
              {stemTracks.length} track{stemTracks.length === 1 ? '' : 's'} with content, downloaded
              one after another
            </span>
          </button>
          <button
            type="button"
            disabled={busy || midiTracks.length === 0}
            onClick={exportMidi}
            className={actionClass}
          >
            <span className="text-sm text-hi">MIDI (.mid)</span>
            <span className="text-[11px] text-low">
              Format 1 at {project.bpm} BPM, one track per MIDI track
            </span>
          </button>
          <button type="button" disabled={busy} onClick={exportJson} className={actionClass}>
            <span className="text-sm text-hi">Project backup (.json)</span>
            <span className="text-[11px] text-low">
              The whole arrangement; audio is referenced, not embedded
            </span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => importInput.current?.click()}
            className={actionClass}
          >
            <span className="text-sm text-hi">Open a project backup…</span>
            <span className="text-[11px] text-low">
              Loads as a new project; the current one stays in your project list
            </span>
          </button>
          <input
            ref={importInput}
            type="file"
            accept=".json,application/json"
            aria-label="Project backup file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) importJson(file);
            }}
          />
        </div>

        <p role="status" aria-live="polite" className="mt-3 min-h-[1.25rem] text-xs text-low">
          {status}
        </p>
      </div>
    </div>
  );
}
