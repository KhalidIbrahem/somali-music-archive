'use client';

/**
 * GeneratePanel — the bottom panel's "Generate" tab: a text prompt to the
 * QaraamiGen generation service, the result placed on a new audio track at
 * the playhead. The service is reached through the AI service's /demo routes
 * (its bearer token stays server-side); the WAV is fetched once and stored in
 * this browser (IndexedDB) so the project plays it like any imported file.
 *
 * Only releasable adapters are offered (lib/daw/studioGeneration). When the
 * build has no live service (aiServiceMode 'off', the public site), the tab
 * says so and points at the Loops browser's published generations instead of
 * showing a control that cannot work.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  generateServed,
  getGenerationStatus,
  AI_URL,
  type GenerationServiceStatus,
  type ServedGeneration,
} from '@/lib/aiService';
import { flags } from '@/lib/flags';
import { audioTrackFor, storeUserAudio } from '@/lib/daw/loops';
import {
  GENERATION_DURATION_MAX,
  GENERATION_DURATION_MIN,
  studioAdapters,
  validateGenerationRequest,
} from '@/lib/daw/studioGeneration';
import type { UpdateFn } from './DawApp';

type ServiceState =
  | { kind: 'checking' }
  | { kind: 'down'; detail: string }
  | { kind: 'ready'; status: GenerationServiceStatus };

type JobState =
  | { kind: 'idle' }
  | { kind: 'generating'; startedAt: number }
  | { kind: 'storing' }
  | { kind: 'done'; result: ServedGeneration; persistent: boolean }
  | { kind: 'error'; message: string };

const DEFAULT_PROMPT =
  'Somali qaraami, solo oud, moderate tempo, pentatonic melody, studio recording, clean';

export function GeneratePanel({
  playheadBeat,
  onUpdate,
  onNotice,
}: {
  playheadBeat: number;
  onUpdate: UpdateFn;
  onNotice: (message: string) => void;
}): React.JSX.Element {
  const [service, setService] = useState<ServiceState>({ kind: 'checking' });
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [adapter, setAdapter] = useState('oud');
  const [duration, setDuration] = useState(15);
  const [seed, setSeed] = useState(42);
  const [job, setJob] = useState<JobState>({ kind: 'idle' });
  const [now, setNow] = useState(() => Date.now());
  const playheadRef = useRef(playheadBeat);
  useEffect(() => {
    playheadRef.current = playheadBeat;
  }, [playheadBeat]);

  const check = useCallback(async (): Promise<void> => {
    setService({ kind: 'checking' });
    try {
      const status = await getGenerationStatus();
      setService(
        status.available
          ? { kind: 'ready', status }
          : { kind: 'down', detail: status.detail ?? 'The generation service is not running.' },
      );
    } catch {
      setService({ kind: 'down', detail: `The AI service at ${AI_URL} did not answer.` });
    }
  }, []);

  useEffect(() => {
    if (flags.aiServiceMode !== 'off') void check();
  }, [check]);

  // A real elapsed-time readout while the service works (no invented progress).
  useEffect(() => {
    if (job.kind !== 'generating') return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [job.kind]);

  const options = useMemo(
    () => (service.kind === 'ready' ? studioAdapters(service.status) : []),
    [service],
  );
  useEffect(() => {
    if (options.length > 0 && !options.some((o) => o.id === adapter)) setAdapter(options[0]!.id);
  }, [options, adapter]);

  const generate = useCallback(async (): Promise<void> => {
    const invalid = validateGenerationRequest({ prompt, duration, seed });
    if (invalid) {
      setJob({ kind: 'error', message: invalid });
      return;
    }
    setJob({ kind: 'generating', startedAt: Date.now() });
    setNow(Date.now());
    try {
      const result = await generateServed({ prompt: prompt.trim(), adapter, duration, seed });
      setJob({ kind: 'storing' });
      const res = await fetch(`${AI_URL}${result.audio}`);
      if (!res.ok)
        throw new Error(`The generated audio could not be fetched (HTTP ${res.status}).`);
      const blob = await res.blob();
      const name = `Generated · ${adapter} · seed ${seed}`;
      const stored = await storeUserAudio(blob, name);
      onUpdate((draft) => {
        const { track } = audioTrackFor(
          stored.source,
          name,
          result.duration,
          draft,
          Math.max(0, playheadRef.current),
        );
        draft.tracks.push(track);
      });
      setJob({ kind: 'done', result, persistent: stored.persistent });
      onNotice(`Added a ${result.duration.toFixed(0)} s generation as a new audio track.`);
    } catch (err) {
      setJob({ kind: 'error', message: err instanceof Error ? err.message : 'Generation failed.' });
    }
  }, [adapter, duration, onNotice, onUpdate, prompt, seed]);

  if (flags.aiServiceMode === 'off') {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="max-w-xl text-sm text-low">
          Live generation runs on the research machine and is not connected to this site. Open Loops
          for the published QaraamiGen generations: every one can be dropped onto the timeline,
          analysed in the Pitch tab, and arranged with the instruments.
        </p>
      </div>
    );
  }

  const busy = job.kind === 'generating' || job.kind === 'storing';
  const field = 'numeric flex flex-col gap-1 text-[10px] tracking-[0.14em] text-low uppercase';
  const input =
    'rounded-[4px] border border-hairline bg-chrome-2 px-2 py-1 text-sm tracking-normal text-hi normal-case outline-none focus:border-accent-state disabled:opacity-50';

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3 lg:flex-row">
      <form
        className="flex min-w-0 flex-1 flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && options.length > 0) void generate();
        }}
      >
        <label className={field}>
          Describe the music
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={400}
            rows={2}
            disabled={busy}
            className={`${input} resize-y`}
          />
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <label className={field}>
            Model
            <select
              value={adapter}
              onChange={(e) => setAdapter(e.target.value)}
              disabled={busy || options.length === 0}
              className={input}
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            Length {duration} s
            <input
              type="range"
              min={GENERATION_DURATION_MIN}
              max={GENERATION_DURATION_MAX}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              disabled={busy}
              className="w-36 accent-(--accent-state)"
            />
          </label>
          <label className={field}>
            Seed
            <input
              type="number"
              min={0}
              value={seed}
              onChange={(e) => setSeed(Math.floor(Number(e.target.value)))}
              disabled={busy}
              className={`${input} w-28`}
            />
          </label>
          <button
            type="submit"
            disabled={busy || options.length === 0}
            className="numeric rounded-[4px] border border-accent-state px-3 py-1.5 text-[11px] tracking-[0.14em] text-accent-state uppercase transition-colors hover:bg-chrome-2 disabled:opacity-40"
          >
            {busy ? 'Working…' : 'Generate to new track'}
          </button>
        </div>
      </form>

      <section aria-label="Generation status" className="flex shrink-0 flex-col gap-2 lg:w-80">
        <p className="text-[12px] text-low" role="status" aria-live="polite">
          {service.kind === 'checking'
            ? 'Checking the generation service…'
            : service.kind === 'down'
              ? service.detail
              : options.length === 0
                ? 'The service is up, but none of its loaded models is cleared for Studio projects.'
                : job.kind === 'generating'
                  ? `Generating on the research machine… ${Math.round((now - job.startedAt) / 1000)} s elapsed. Large clips can take minutes.`
                  : job.kind === 'storing'
                    ? 'Saving the audio into this browser…'
                    : job.kind === 'done'
                      ? `Done: ${job.result.duration.toFixed(1)} s${job.result.total_seconds ? ` in ${job.result.total_seconds.toFixed(0)} s` : ''}. Placed on a new track at the playhead${job.persistent ? '' : ' (kept for this session only: browser storage is unavailable)'}.`
                      : 'Ready. The clip lands on a new audio track at the playhead.'}
        </p>
        {job.kind === 'done' && job.result.pcs?.pcs != null ? (
          <p className="numeric text-[11px] text-low">
            Service scores: pentatonic conformity {job.result.pcs.pcs.toFixed(2)}
            {job.result.pcs.voiced_fraction != null
              ? ` · voiced ${job.result.pcs.voiced_fraction.toFixed(2)}`
              : ''}
          </p>
        ) : null}
        {job.kind === 'error' ? (
          <p className="text-[12px] text-danger" role="alert">
            {job.message}
          </p>
        ) : null}
        {service.kind === 'down' ? (
          <button
            type="button"
            onClick={() => void check()}
            className="numeric self-start rounded-[4px] border border-hairline px-3 py-1.5 text-[11px] tracking-[0.14em] text-low uppercase hover:text-hi"
          >
            Check again
          </button>
        ) : null}
        <p className="text-[11px] leading-relaxed text-low">
          Only models trained on recordings cleared for release are offered here. The same prompt,
          model and seed reproduce the same clip.
        </p>
      </section>
    </div>
  );
}
