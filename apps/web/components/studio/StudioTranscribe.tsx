'use client';

/**
 * StudioTranscribe — instrument picker → upload → live stages → engraved score.
 *
 * The studio's own take on the transcription flow (the archive's /transcribe
 * keeps its amber look; this one lives in the .qg theme scope). Talks to the
 * same notation service: POST /notation with `instrument` + `separate`, poll
 * the job's live `stage`, then render the SVG score with A/B playback and
 * downloads. Duplicate uploads reuse the running job server-side.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const AI_URL = process.env['NEXT_PUBLIC_AI_URL'] ?? 'http://localhost:8000';

const INSTRUMENTS = [
  { id: 'full', so: 'Codka & Kaban', en: 'Full arrangement', desc: 'Voice + kaban · two staves' },
  { id: 'voice', so: 'Codka', en: 'Voice', desc: 'The sung melody · 10 ms tracking' },
  { id: 'kaban', so: 'Kaban', en: 'Oud', desc: 'The heart of qaraami' },
  { id: 'violin', so: 'Fiyooliin', en: 'Violin', desc: 'String lead lines' },
  { id: 'flute', so: 'Biibiile', en: 'Flute', desc: 'Wind melodies' },
] as const;
type InstrumentId = (typeof INSTRUMENTS)[number]['id'];

interface NotationResult {
  n_notes: number;
  tonic: string;
  degrees: number[];
  tuning_offset_cents: number;
  bpm: number;
  snapped: number;
  marked_outliers: number;
  mean_confidence: number;
  parts?: string[];
  accomp_notes?: number;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'processing'; jobId: string; startedAt: number; stage?: string }
  | { kind: 'done'; jobId: string; result: NotationResult; svg: string }
  | { kind: 'error'; message: string };

function elapsedLabel(startedAt: number): string {
  const s = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function StudioTranscribe(): React.JSX.Element {
  const [instrument, setInstrument] = useState<InstrumentId>('full');
  const [separate, setSeparate] = useState(true);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [dragOver, setDragOver] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const optionsRef = useRef({ instrument: 'full' as InstrumentId, separate: true });

  useEffect(() => () => stopPolling(), []);
  useEffect(() => {
    void import('html-midi-player').then(() => setPlayerReady(true));
  }, []);

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const poll = async (jobId: string) => {
    try {
      const res = await fetch(`${AI_URL}/notation/jobs/${jobId}`);
      if (!res.ok) throw new Error(`job lookup failed (${res.status})`);
      const state = (await res.json()) as {
        status: string;
        stage?: string;
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
      } else {
        setPhase((p) =>
          p.kind === 'processing' ? { ...p, ...(state.stage ? { stage: state.stage } : {}) } : p,
        );
      }
    } catch {
      // transient poll failure — keep polling
    }
  };

  const submit = useCallback(async (file: File) => {
    setPhase({ kind: 'uploading' });
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('separate', String(optionsRef.current.separate));
      form.append('instrument', optionsRef.current.instrument);
      const res = await fetch(`${AI_URL}/notation`, { method: 'POST', body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(body?.detail ?? `upload failed (${res.status})`);
      }
      const { job_id: jobId } = (await res.json()) as { job_id: string };
      setPhase({ kind: 'processing', jobId, startedAt: Date.now() });
      pollRef.current = setInterval(() => {
        void poll(jobId);
      }, 2000);
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : 'upload failed' });
    }
  }, []);

  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void submit(file);
  };

  const chosen = INSTRUMENTS.find((i) => i.id === instrument);

  return (
    <main className="mx-auto max-w-5xl px-6 py-14">
      <p className="font-body text-sm uppercase tracking-[0.3em] text-[var(--qg-accent)]">
        Qoraalka muusikada
      </p>
      <h1 className="mt-2 font-display text-4xl text-[var(--qg-ink)]">Transcribe a recording</h1>
      <p className="mt-3 max-w-2xl font-body text-[var(--qg-ink2)]">
        Pick the instrument, drop the audio. Notes outside the detected scale are{' '}
        <span className="text-[#c05555]">kept and marked</span> — ornaments and microtonal
        inflections are music, not errors.
      </p>

      {/* ── Instrument picker ─────────────────────────────────────────────── */}
      {(phase.kind === 'idle' || phase.kind === 'error') && (
        <>
          <div className="mt-8 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {INSTRUMENTS.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => {
                  setInstrument(i.id);
                  optionsRef.current.instrument = i.id;
                }}
                aria-pressed={instrument === i.id}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  instrument === i.id
                    ? 'border-[var(--qg-accent)] bg-[var(--qg-accent-soft)]'
                    : 'border-[var(--qg-line)] bg-[var(--qg-panel)] hover:border-[var(--qg-accent)]/50'
                }`}
              >
                <span className="block font-display text-lg text-[var(--qg-ink)]">{i.so}</span>
                <span className="block font-body text-[11px] uppercase tracking-wider text-[var(--qg-accent)]">
                  {i.en}
                </span>
                <span className="mt-1.5 block font-body text-xs text-[var(--qg-ink2)]">
                  {i.desc}
                </span>
              </button>
            ))}
          </div>

          <label className="mt-5 flex w-fit cursor-pointer items-center gap-2 font-body text-sm text-[var(--qg-ink2)]">
            <input
              type="checkbox"
              checked={separate}
              onChange={(e) => {
                setSeparate(e.target.checked);
                optionsRef.current.separate = e.target.checked;
              }}
              className="h-4 w-4 accent-[var(--qg-accent)]"
            />
            Separate the sources first — best for band recordings (adds a few minutes)
          </label>

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
            className={`mt-6 flex h-52 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-colors ${
              dragOver
                ? 'border-[var(--qg-accent)] bg-[var(--qg-accent-soft)]'
                : 'border-[var(--qg-line)] bg-[var(--qg-panel)]'
            }`}
          >
            <p className="font-display text-xl text-[var(--qg-ink)]">
              Drop audio here — transcribing the {chosen?.en.toLowerCase()}
            </p>
            <p className="mt-2 font-body text-sm text-[var(--qg-ink3)]">
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
        </>
      )}

      {phase.kind === 'error' && (
        <p className="mt-4 rounded-lg border border-[#B03030]/40 bg-[#B03030]/10 px-4 py-3 font-body text-sm text-[#c05555]">
          {phase.message}
        </p>
      )}

      {/* ── Working ───────────────────────────────────────────────────────── */}
      {(phase.kind === 'uploading' || phase.kind === 'processing') && (
        <div className="mt-10 flex h-52 flex-col items-center justify-center rounded-2xl border border-[var(--qg-line)] bg-[var(--qg-panel)]">
          <div className="h-2 w-64 overflow-hidden rounded-full bg-[var(--qg-panel2)]">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--qg-accent)]" />
          </div>
          <p className="mt-4 font-body text-sm text-[var(--qg-ink2)]">
            {phase.kind === 'uploading'
              ? 'Uploading…'
              : `${phase.stage ?? 'working'} · ${elapsedLabel(phase.startedAt)}`}
          </p>
          {phase.kind === 'processing' ? (
            <p className="mt-2 font-body text-xs text-[var(--qg-ink3)]">
              Leave this page open — re-uploading the same file won&apos;t start a second job.
            </p>
          ) : null}
        </div>
      )}

      {/* ── Result ────────────────────────────────────────────────────────── */}
      {phase.kind === 'done' && (
        <section className="mt-10">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Part" value={(phase.result.parts ?? ['Melody']).join(' + ')} />
            <Stat label="Tonic" value={phase.result.tonic} />
            <Stat label="Scale" value={phase.result.degrees.map((d) => PC_NAMES[d]).join(' ')} />
            <Stat label="Tempo" value={`${phase.result.bpm} BPM`} />
          </div>
          <p className="mt-3 font-body text-sm text-[var(--qg-ink2)]">
            {phase.result.n_notes} notes · {phase.result.snapped} snapped to scale ·{' '}
            <span className="text-[#c05555]">
              {phase.result.marked_outliers} inflections preserved
            </span>
            {phase.result.accomp_notes ? ` · ${phase.result.accomp_notes} kaban notes` : ''}
          </p>

          <div
            className="mt-6 overflow-x-auto rounded-2xl p-6 [&_svg]:h-auto [&_svg]:max-w-full"
            style={{ background: 'var(--qg-score-bg)' }}
            dangerouslySetInnerHTML={{ __html: phase.svg }}
          />

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="font-body text-sm font-semibold text-[var(--qg-ink)]">
                Original recording
              </p>
              <audio
                controls
                src={`${AI_URL}/notation/jobs/${phase.jobId}/artifacts/original`}
                className="mt-2 w-full"
              />
            </div>
            <div>
              <p className="font-body text-sm font-semibold text-[var(--qg-ink)]">
                Transcription playback
              </p>
              {playerReady && (
                <midi-player
                  src={`${AI_URL}/notation/jobs/${phase.jobId}/artifacts/midi`}
                  sound-font="https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus"
                  className="mt-2 block w-full"
                />
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            {(['musicxml', 'svg', 'midi'] as const).map((kind) => (
              <a
                key={kind}
                href={`${AI_URL}/notation/jobs/${phase.jobId}/artifacts/${kind}`}
                download
                className="rounded-lg border border-[var(--qg-accent)]/50 px-4 py-2 font-body text-sm font-semibold text-[var(--qg-accent)] transition-colors hover:bg-[var(--qg-accent)] hover:text-[var(--qg-bg)]"
              >
                Download {kind === 'midi' ? 'MIDI' : kind === 'svg' ? 'SVG' : 'MusicXML'}
              </a>
            ))}
            <button
              type="button"
              onClick={() => setPhase({ kind: 'idle' })}
              className="rounded-lg border border-[var(--qg-line)] px-4 py-2 font-body text-sm text-[var(--qg-ink2)] transition-colors hover:text-[var(--qg-ink)]"
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
    <div className="rounded-xl border border-[var(--qg-line)] bg-[var(--qg-panel)] p-4">
      <p className="font-body text-xs uppercase tracking-wider text-[var(--qg-ink3)]">{label}</p>
      <p className="mt-1 font-display text-lg text-[var(--qg-ink)]">{value}</p>
    </div>
  );
}
