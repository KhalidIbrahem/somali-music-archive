'use client';

/**
 * TranscribeStudio — upload → poll job → rendered score + downloads.
 *
 * Talks directly to the AI service (NEXT_PUBLIC_AI_URL): POST /notation with
 * the file, poll GET /notation/jobs/{id} every 2 s, then inline the Verovio
 * SVG and offer MusicXML / SVG / MIDI downloads. Marked (red, ~) notes are
 * preserved microtonal inflections, not errors — the legend says so.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const AI_URL = process.env['NEXT_PUBLIC_AI_URL'] ?? 'http://localhost:8000';
const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

interface NotationResult {
  n_notes: number;
  tonic: string;
  mode: number;
  degrees: number[];
  tuning_offset_cents: number;
  bpm: number;
  snapped: number;
  marked_outliers: number;
  mean_confidence: number;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'processing'; jobId: string }
  | { kind: 'done'; jobId: string; result: NotationResult; svg: string }
  | { kind: 'error'; message: string };

export function TranscribeStudio(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [dragOver, setDragOver] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => stopPolling(), []);

  useEffect(() => {
    // registers the <midi-player> custom element (client only, tone.js inside)
    void import('html-midi-player').then(() => setPlayerReady(true));
  }, []);

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const submit = useCallback(async (file: File) => {
    setPhase({ kind: 'uploading' });
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${AI_URL}/notation`, { method: 'POST', body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(body?.detail ?? `upload failed (${res.status})`);
      }
      const { job_id: jobId } = (await res.json()) as { job_id: string };
      setPhase({ kind: 'processing', jobId });
      pollRef.current = setInterval(() => {
        void poll(jobId);
      }, 2000);
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : 'upload failed' });
    }
  }, []);

  const poll = async (jobId: string) => {
    try {
      const res = await fetch(`${AI_URL}/notation/jobs/${jobId}`);
      if (!res.ok) throw new Error(`job lookup failed (${res.status})`);
      const state = (await res.json()) as {
        status: string;
        result?: NotationResult;
        error?: string;
      };
      if (state.status === 'done' && state.result) {
        stopPolling();
        const svg = await (await fetch(`${AI_URL}/notation/jobs/${jobId}/artifacts/svg`)).text();
        setPhase({ kind: 'done', jobId, result: state.result, svg });
      } else if (state.status === 'error') {
        stopPolling();
        setPhase({ kind: 'error', message: state.error ?? 'transcription failed' });
      }
    } catch {
      // transient poll failure — keep polling
    }
  };

  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void submit(file);
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <p className="font-body text-sm uppercase tracking-[0.3em] text-amber">Qormada</p>
      <h1 className="mt-2 font-display text-4xl text-ink-primary">Audio → sheet music</h1>
      <p className="mt-3 max-w-2xl font-body text-ink-secondary">
        Upload a recording and get notation that detects the pentatonic scale from the audio itself.
        Notes outside the scale are <span className="text-[#e07070]">kept and marked</span> —
        ornaments and microtonal inflections are music, not errors.
      </p>

      {phase.kind === 'idle' || phase.kind === 'error' ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            onFiles(e.dataTransfer.files);
          }}
          className={`mt-10 flex h-56 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-colors ${
            dragOver ? 'border-amber bg-amber-subtle' : 'border-line-primary bg-bg-secondary'
          }`}
        >
          <p className="font-display text-xl text-ink-primary">Drop audio here</p>
          <p className="mt-2 font-body text-sm text-ink-tertiary">
            or click to choose — wav, mp3, m4a, flac, ogg · up to 50 MB
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".wav,.mp3,.m4a,.flac,.ogg,audio/*"
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>
      ) : null}

      {phase.kind === 'error' && (
        <p className="mt-4 rounded-lg border border-[#B03030]/40 bg-[#B03030]/10 px-4 py-3 font-body text-sm text-[#e07070]">
          {phase.message}
        </p>
      )}

      {(phase.kind === 'uploading' || phase.kind === 'processing') && (
        <div className="mt-10 flex h-56 flex-col items-center justify-center rounded-2xl border border-line-primary bg-bg-secondary">
          <div className="h-2 w-64 overflow-hidden rounded-full bg-bg-tertiary">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-amber" />
          </div>
          <p className="mt-4 font-body text-sm text-ink-secondary">
            {phase.kind === 'uploading'
              ? 'Uploading…'
              : 'Detecting notes and scale — this takes ten seconds or so'}
          </p>
        </div>
      )}

      {phase.kind === 'done' && (
        <section className="mt-10">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Tonic" value={phase.result.tonic} />
            <Stat label="Scale" value={phase.result.degrees.map((d) => PC_NAMES[d]).join(' ')} />
            <Stat label="Tempo" value={`${phase.result.bpm} BPM`} />
            <Stat
              label="Tape drift"
              value={`${phase.result.tuning_offset_cents > 0 ? '+' : ''}${phase.result.tuning_offset_cents}¢`}
            />
          </div>
          <p className="mt-3 font-body text-sm text-ink-secondary">
            {phase.result.n_notes} notes · {phase.result.snapped} snapped to scale ·{' '}
            <span className="text-[#e07070]">
              {phase.result.marked_outliers} inflections preserved
            </span>{' '}
            · confidence {Math.round(phase.result.mean_confidence * 100)}%
          </p>

          <div
            className="mt-6 overflow-x-auto rounded-2xl bg-bg-inverse p-6 [&_svg]:h-auto [&_svg]:max-w-full"
            dangerouslySetInnerHTML={{ __html: phase.svg }}
          />

          {playerReady && (
            <midi-player
              src={`${AI_URL}/notation/jobs/${phase.jobId}/artifacts/midi`}
              sound-font=""
              className="mt-6 block w-full"
            />
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            {(['musicxml', 'svg', 'midi'] as const).map((kind) => (
              <a
                key={kind}
                href={`${AI_URL}/notation/jobs/${phase.jobId}/artifacts/${kind}`}
                download
                className="rounded-lg border border-amber/40 px-4 py-2 font-body text-sm font-semibold text-amber transition-colors hover:bg-amber hover:text-bg-primary"
              >
                Download {kind === 'midi' ? 'MIDI' : kind === 'svg' ? 'SVG' : 'MusicXML'}
              </a>
            ))}
            <button
              type="button"
              onClick={() => setPhase({ kind: 'idle' })}
              className="rounded-lg border border-line-primary px-4 py-2 font-body text-sm text-ink-secondary transition-colors hover:text-ink-primary"
            >
              Transcribe another
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-line-secondary bg-bg-secondary px-4 py-3">
      <p className="font-body text-xs uppercase tracking-wider text-ink-tertiary">{label}</p>
      <p className="mt-1 font-display text-lg text-amber">{value}</p>
    </div>
  );
}
