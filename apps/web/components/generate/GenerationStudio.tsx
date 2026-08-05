'use client';

/**
 * GenerationStudio — describe → generate → poll → play (/generate).
 *
 * Calls the Node API's provider-agnostic endpoint (POST /generate, then GET
 * /generate/:jobId every 3s until terminal — the API asks clients to poll no
 * faster). The wire `provider` id selects a QaraamiGen model tier; which
 * engine serves each tier is a backend implementation detail (lib/brand.ts),
 * so this page never changes when the backend swaps engines. Playback is a
 * native <audio>: `track.audioUrl` is an opaque playable source (https URL,
 * signed R2 URL, or data: URI).
 *
 * Requires a signed-in session (generation spends provider credits); signed-out
 * visitors get an invitation, mirroring LibraryShelf.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import type { GenerationJob, MusicProvider } from '@sma/types';
import { ApiError, getGenerationJob, requestGeneration } from '@/lib/api';
import { brandMessage, brandProviderName, MODEL_TIERS } from '@/lib/brand';
import { getToken } from '@/lib/auth';
import { Reveal } from '@/components/Reveal';

const POLL_INTERVAL_MS = 3_000;

const PROVIDERS = MODEL_TIERS;

/** Prompt starters rooted in the archive's genres — a nudge, not a constraint. */
const STARTERS: ReadonlyArray<{ label: string; prompt: string }> = [
  { label: 'Qaraami', prompt: 'A gentle qaraami love song with solo oud, 1960s Mogadishu style' },
  { label: 'Dhaanto', prompt: 'An upbeat dhaanto with hand claps and call-and-response vocals' },
  { label: 'Heello', prompt: 'A golden-age heello with full band, flute lines and warm vocals' },
  { label: 'Buraanbur', prompt: 'A celebratory buraanbur rhythm with frame drums and ululation' },
];

const emptySubscribe = (): (() => void) => () => undefined;
function useHasSession(): boolean | null {
  return useSyncExternalStore(
    emptySubscribe,
    () => Boolean(getToken()),
    () => null,
  );
}

const isTerminal = (job: GenerationJob): boolean =>
  job.state === 'succeeded' || job.state === 'failed';

export function GenerationStudio(): React.JSX.Element {
  const hasToken = useHasSession();
  const [authFailed, setAuthFailed] = useState(false);

  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState<MusicProvider>('local');
  const [instrumental, setInstrumental] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const poll = useCallback(
    async (jobId: string) => {
      try {
        const next = await getGenerationJob(jobId);
        setJob(next);
        if (isTerminal(next)) stopPolling();
      } catch (err) {
        // Transient poll failures are swallowed (keep polling) — but a dead
        // session should surface, not spin forever.
        if (err instanceof ApiError && err.code.startsWith('AUTH')) {
          stopPolling();
          setAuthFailed(true);
        }
      }
    },
    [stopPolling],
  );

  const submit = useCallback(async () => {
    if (submitting || prompt.trim().length < 3) return;
    setError(null);
    setJob(null);
    setSubmitting(true);
    try {
      const created = await requestGeneration({
        provider,
        prompt: prompt.trim(),
        instrumental,
      });
      setJob(created);
      if (!isTerminal(created)) {
        pollRef.current = setInterval(() => void poll(created.id), POLL_INTERVAL_MS);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code.startsWith('AUTH')) setAuthFailed(true);
      else if (err instanceof ApiError && err.code === 'RATE_LIMITED') {
        setError('You have reached the hourly generation limit — try again a little later.');
      } else {
        setError(
          err instanceof ApiError ? brandMessage(err.message) : 'Generation failed — try again.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }, [submitting, prompt, provider, instrumental, poll]);

  const working = submitting || (job !== null && !isTerminal(job));

  return (
    <main className="pb-24">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-line-secondary">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[46rem] rounded-full bg-amber/10 blur-3xl animate-glow-drift"
        />
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-5 px-6 py-20 text-center">
          <Reveal>
            <p className="font-body text-sm uppercase tracking-[0.3em] text-amber">Abuur</p>
          </Reveal>
          <Reveal delay={90}>
            <h1 className="font-display text-5xl leading-tight text-ink-primary sm:text-6xl">
              The Generation Studio
            </h1>
          </Reveal>
          <Reveal delay={180}>
            <p className="max-w-2xl font-body text-lg leading-relaxed text-ink-secondary">
              Describe a song and let AI compose in the spirit of the Somali musical tradition. This
              studio is built on our own AI research, where we are training foundation models using
              restored Somali music archives to preserve, analyze, and extend the Qaraami tradition.
              Every generated composition is an experimental interpretation, always kept separate
              from the authentic archival recordings that inspire it.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-14">
        {hasToken === false || authFailed ? (
          <Reveal>
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-line-secondary bg-bg-secondary p-12 text-center">
              <h2 className="font-display text-2xl text-ink-primary">Sign in to generate</h2>
              <p className="max-w-md font-body text-ink-secondary">
                Generation runs on dedicated research compute, so the studio is reserved for
                signed-in members.
              </p>
              <Link
                href="/login"
                className="mt-2 rounded-xl bg-amber px-7 py-3 font-body font-semibold text-bg-primary transition-transform hover:-translate-y-0.5"
              >
                Sign in
              </Link>
            </div>
          </Reveal>
        ) : (
          <div className="flex flex-col gap-8">
            {/* ── Prompt form ─────────────────────────────────────────────── */}
            <Reveal>
              <div className="rounded-2xl border border-line-secondary bg-bg-secondary p-8">
                <label
                  htmlFor="gen-prompt"
                  className="font-body text-sm font-semibold text-ink-primary"
                >
                  Describe the music
                </label>
                <textarea
                  id="gen-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="e.g. A gentle qaraami love song with solo oud and soft percussion…"
                  className="mt-2 w-full resize-y rounded-lg border border-line-primary bg-bg-tertiary px-4 py-3 font-body text-ink-primary placeholder:text-ink-tertiary focus:border-amber focus:outline-none"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  {STARTERS.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      onClick={() => setPrompt(s.prompt)}
                      className="rounded-full border border-line-primary px-3 py-1 font-body text-xs text-ink-secondary transition-colors hover:border-amber hover:text-amber"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                {/* Provider choice */}
                <fieldset className="mt-6">
                  <legend className="font-body text-sm font-semibold text-ink-primary">
                    Model
                  </legend>
                  <div className="mt-2 grid gap-3 sm:grid-cols-3">
                    {PROVIDERS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setProvider(p.id)}
                        aria-pressed={provider === p.id}
                        className={`rounded-xl border p-4 text-left transition-colors ${
                          provider === p.id
                            ? 'border-amber bg-amber/10'
                            : 'border-line-primary bg-bg-tertiary hover:border-amber/50'
                        }`}
                      >
                        <span className="block font-body font-semibold text-ink-primary">
                          {p.label}
                        </span>
                        <span className="mt-1 block font-body text-xs text-ink-secondary">
                          {p.note}
                        </span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
                  <label className="flex items-center gap-2 font-body text-sm text-ink-secondary">
                    <input
                      type="checkbox"
                      checked={instrumental}
                      onChange={(e) => setInstrumental(e.target.checked)}
                      className="h-4 w-4 accent-amber"
                    />
                    Instrumental only — no vocals
                  </label>
                  <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={working || prompt.trim().length < 3}
                    className="rounded-xl bg-amber px-7 py-3 font-body font-semibold text-bg-primary transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {working ? 'Generating…' : 'Generate'}
                  </button>
                </div>
                {error ? (
                  <p className="mt-4 font-body text-sm text-[#e07070]" role="alert">
                    {error}
                  </p>
                ) : null}
              </div>
            </Reveal>

            {/* ── Job status / result ─────────────────────────────────────── */}
            {job ? (
              <Reveal>
                <div className="rounded-2xl border border-line-secondary bg-bg-secondary p-8">
                  {job.state === 'queued' || job.state === 'running' ? (
                    <div className="flex items-center gap-4">
                      <span className="eq" aria-hidden />
                      <div>
                        <p className="font-body font-semibold text-ink-primary">
                          {job.state === 'queued' ? 'Queued…' : 'Composing…'}
                        </p>
                        <p className="font-body text-sm text-ink-secondary">
                          {brandProviderName(job.provider)} is working — this can take a minute or
                          two. The page checks every few seconds.
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {job.state === 'failed' ? (
                    <div>
                      <p className="font-body font-semibold text-[#e07070]">Generation failed</p>
                      <p className="mt-1 font-body text-sm text-ink-secondary">
                        {brandMessage(job.error ?? 'Unknown error')}
                      </p>
                    </div>
                  ) : null}

                  {job.state === 'succeeded' && job.track ? (
                    <div className="flex flex-col gap-4">
                      <div className="flex items-baseline justify-between gap-4">
                        <h2 className="font-display text-2xl text-ink-primary">
                          {job.track.title ?? 'Generated track'}
                        </h2>
                        <span className="rounded-full border border-amber/40 px-3 py-1 font-body text-xs uppercase tracking-wider text-amber">
                          AI-generated · {brandProviderName(job.provider)}
                        </span>
                      </div>
                      {/* audioUrl is opaque & directly playable: https, signed R2, or data: */}
                      <audio controls src={job.track.audioUrl} className="w-full">
                        Your browser cannot play this audio.
                      </audio>
                      {job.track.lyrics ? (
                        <details className="rounded-lg border border-line-primary bg-bg-tertiary p-4">
                          <summary className="cursor-pointer font-body text-sm font-semibold text-ink-primary">
                            Lyrics / structure
                          </summary>
                          <pre className="mt-3 whitespace-pre-wrap font-body text-sm text-ink-secondary">
                            {job.track.lyrics}
                          </pre>
                        </details>
                      ) : null}
                      <p className="font-body text-xs text-ink-tertiary">
                        Generated pieces are experiments and are not part of the preservation
                        archive.
                      </p>
                    </div>
                  ) : null}
                </div>
              </Reveal>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
