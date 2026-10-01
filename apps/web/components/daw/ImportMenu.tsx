'use client';

/**
 * ImportMenu (Studio v2) — bring material into the project:
 *  • the sample transcription (public/sample/session.json) or any
 *    transcription JSON → a MIDI track on the chosen instrument;
 *  • a Standard MIDI File → one MIDI track per MIDI track/channel;
 *  • an audio file (wav/mp3/m4a/ogg) → a new audio track at the playhead,
 *    kept in this browser (IndexedDB when the audio store is registered,
 *    otherwise for this session only).
 * Nothing here uploads anything; files stay on the member's device.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { clampBpm, midiToDawTracks, parseMidi } from '@/lib/daw/midi';
import {
  IMPORTABLE_AUDIO,
  IMPORTABLE_AUDIO_ACCEPT,
  audioDuration,
  audioTrackFor,
  storeUserAudio,
} from '@/lib/daw/loops';
import {
  fetchSampleTranscription,
  parseTranscription,
  transcriptionToTrack,
  type Transcription,
} from '@/lib/daw/transcriptionImport';
import { INSTRUMENT_LABELS, type DawProject, type InstrumentId } from '@/lib/daw/types';

const MELODIC: InstrumentId[] = ['oud', 'keys', 'bass'];
const MAX_MIDI_BYTES = 8 * 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024 * 1024;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

export function ImportMenu({
  project,
  playheadBeat,
  onUpdate,
}: {
  project: DawProject;
  playheadBeat: number;
  onUpdate: (mutate: (draft: DawProject) => void) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [instrument, setInstrument] = useState<InstrumentId>('oud');
  const [adoptTempo, setAdoptTempo] = useState(false);
  const [skipMarked, setSkipMarked] = useState(false);
  const [status, setStatus] = useState('');
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const transcriptionInput = useRef<HTMLInputElement | null>(null);
  const midiInput = useRef<HTMLInputElement | null>(null);
  const audioInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const start = Math.max(0, playheadBeat);

  const run = useCallback(async (task: () => Promise<string>): Promise<void> => {
    setBusy(true);
    setStatus('Importing…');
    try {
      setStatus(await task());
      setOpen(false);
    } catch (error) {
      setStatus(`Import failed: ${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const addTranscription = useCallback(
    (transcription: Transcription): string => {
      onUpdate((draft) => {
        if (adoptTempo && transcription.bpm !== null) draft.bpm = clampBpm(transcription.bpm);
        draft.tracks.push(
          transcriptionToTrack(transcription, draft, instrument, {
            startBeat: start,
            skipMarked,
          }),
        );
      });
      return `Added “${transcription.title}” (${transcription.notes.length} notes) as a ${INSTRUMENT_LABELS[instrument]} track.`;
    },
    [onUpdate, instrument, start, skipMarked, adoptTempo],
  );

  const importSample = (): void => {
    void run(async () => addTranscription(await fetchSampleTranscription()));
  };

  const onTranscriptionFile = (file: File): void => {
    void run(async () => {
      if (file.size > MAX_JSON_BYTES) throw new Error('the file is larger than 16 MB');
      return addTranscription(parseTranscription(JSON.parse(await file.text()) as unknown));
    });
  };

  const onMidiFile = (file: File): void => {
    void run(async () => {
      if (file.size > MAX_MIDI_BYTES) throw new Error('the file is larger than 8 MB');
      const parsed = parseMidi(await file.arrayBuffer());
      const tracks = midiToDawTracks(parsed, {
        instrument,
        startBeat: start,
        beatsPerBar: project.timeSignature.beatsPerBar,
      });
      if (tracks.length === 0) throw new Error('the file has no notes');
      onUpdate((draft) => {
        if (adoptTempo && parsed.hasTempo) draft.bpm = clampBpm(parsed.bpm);
        draft.tracks.push(...tracks);
      });
      return `Added ${tracks.length} MIDI track${tracks.length === 1 ? '' : 's'} from ${file.name}.`;
    });
  };

  const onAudioFile = (file: File): void => {
    void run(async () => {
      if (!IMPORTABLE_AUDIO.test(file.name) && !file.type.startsWith('audio/')) {
        throw new Error('choose a WAV, MP3, M4A or OGG file');
      }
      const stored = await storeUserAudio(file, file.name);
      // Duration from a temporary URL, so idb: sources need no engine support here.
      const probe = URL.createObjectURL(file);
      let duration: number;
      try {
        duration = await audioDuration(probe);
      } finally {
        if (probe !== stored.source) URL.revokeObjectURL(probe);
      }
      const name = file.name.replace(/\.[^.]+$/, '');
      const { track } = audioTrackFor(stored.source, name, duration, project, start);
      onUpdate((draft) => {
        draft.tracks.push(track);
      });
      return stored.persistent
        ? `Added “${name}” on a new audio track.`
        : `Added “${name}” on a new audio track — kept for this session only (it will not survive a reload).`;
    });
  };

  const fileInput = (
    ref: React.RefObject<HTMLInputElement | null>,
    accept: string,
    label: string,
    onFile: (file: File) => void,
  ): React.JSX.Element => (
    <input
      ref={ref}
      type="file"
      accept={accept}
      aria-label={label}
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) onFile(file);
      }}
    />
  );

  const itemClass =
    'w-full rounded-[4px] px-3 py-2 text-left text-sm text-hi transition-colors hover:bg-chrome-2 disabled:opacity-50';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="numeric rounded-[4px] border border-hairline px-3 py-1.5 text-[11px] tracking-[0.14em] text-low uppercase transition-colors hover:border-accent-state hover:text-hi"
      >
        Import ▾
      </button>
      {fileInput(
        transcriptionInput,
        '.json,application/json',
        'Transcription JSON file',
        onTranscriptionFile,
      )}
      {fileInput(midiInput, '.mid,.midi,audio/midi,audio/x-midi', 'MIDI file', onMidiFile)}
      {fileInput(audioInput, IMPORTABLE_AUDIO_ACCEPT, 'Audio file', onAudioFile)}

      {open ? (
        <div
          id={panelId}
          className="absolute left-0 z-40 mt-1 w-72 rounded-[4px] border border-hairline bg-chrome-1 p-2 shadow-xl"
        >
          <button type="button" disabled={busy} onClick={importSample} className={itemClass}>
            Import sample transcription
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => transcriptionInput.current?.click()}
            className={itemClass}
          >
            Import transcription (.json)…
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => midiInput.current?.click()}
            className={itemClass}
          >
            Import MIDI file (.mid)…
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => audioInput.current?.click()}
            className={itemClass}
          >
            Import audio file…
          </button>

          <div className="mt-2 flex flex-col gap-2 border-t border-hairline px-3 pt-2 text-xs text-low">
            <label className="flex items-center justify-between gap-2">
              Notes play on
              <select
                value={instrument}
                onChange={(e) => setInstrument(e.target.value as InstrumentId)}
                className="rounded-[4px] border border-hairline bg-chrome-2 px-2 py-1 text-xs text-hi"
              >
                {MELODIC.map((id) => (
                  <option key={id} value={id}>
                    {INSTRUMENT_LABELS[id]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={skipMarked}
                onChange={(e) => setSkipMarked(e.target.checked)}
                className="accent-[#C89B5F]"
              />
              Skip notes marked as outliers
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={adoptTempo}
                onChange={(e) => setAdoptTempo(e.target.checked)}
                className="accent-[#C89B5F]"
              />
              Adopt the file’s tempo
            </label>
            <p className="text-[10px] leading-snug">
              Imports land at the playhead. Files stay in this browser.
            </p>
          </div>
        </div>
      ) : null}
      <div role="status" aria-live="polite">
        {status && !open ? (
          <div className="absolute left-0 z-30 mt-1 flex w-72 items-start gap-2 rounded-[4px] border border-hairline bg-chrome-1 px-3 py-2 text-xs text-low shadow-xl">
            <span className="min-w-0 flex-1">{status}</span>
            <button
              type="button"
              onClick={() => setStatus('')}
              aria-label="Dismiss import message"
              className="shrink-0 text-low hover:text-hi"
            >
              ✕
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
