'use client';

/**
 * ServedGenerationStudio (/generate, behind NEXT_PUBLIC_GENERATE_SERVED_ONLY).
 *
 * Lists the adapters the local generation service is serving right now, read
 * from the AI service's /demo/config, and generates through the AI service's
 * server-side proxy (POST /demo/generate, then the wav from /demo/audio/{id}),
 * the same path the AI service's own /demo page uses. No tiers, nothing that
 * is not running. Errors show the backend's own message.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AI_URL,
  adapterCards,
  generateServed,
  getGenerationStatus,
  ServiceError,
  type AdapterCard,
  type GenerationServiceStatus,
  type ServedGeneration,
} from '@/lib/aiService';
import { Reveal } from '@/components/Reveal';

const STARTERS: ReadonlyArray<{ label: string; prompt: string }> = [
  { label: 'Qaraami', prompt: 'Somali qaraami led by the oud (kaban), moderate tempo, pentatonic melody, intimate recording' },
  { label: 'Dhaanto', prompt: 'A dhaanto rhythm with hand drums and a pentatonic oud line' },
  { label: 'Heello', prompt: 'A heello with oud and light percussion, slow and lyrical' },
];
const DURATIONS = [5, 10, 15] as const;

type Status =
  | { kind: 'loading' }
  | { kind: 'ready'; service: GenerationServiceStatus; cards: AdapterCard[] }
  | { kind: 'down'; message: string };

export function ServedGenerationStudio(): React.JSX.Element {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [adapter, setAdapter] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState<number>(10);
  const [seed, setSeed] = useState<number>(42);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<ServedGeneration | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getGenerationStatus()
      .then((service) => {
        if (cancelled) return;
        if (!service.available) {
          setStatus({
            kind: 'down',
            message: `The generation service at ${service.url ?? 'its configured address'} is not reachable${service.detail ? ` (${service.detail})` : ''}.`,
          });
          return;
        }
        const cards = adapterCards(service);
        setStatus({ kind: 'ready', service, cards });
        setAdapter(cards.some((c) => c.id === 'oud') ? 'oud' : (cards[0]?.id ?? ''));
      })
      .catch((err: unknown) => {
        if (!cancelled) setStatus({ kind: 'down', message: `Could not reach the AI service at ${AI_URL}: ${err instanceof Error ? err.message : String(err)}` });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = useCallback(async () => {
    if (working || prompt.trim().length < 3 || !adapter) return;
    setError(null);
    setResult(null);
    setWorking(true);
    try {
      setResult(await generateServed({ prompt: prompt.trim(), adapter, duration, seed }));
    } catch (err) {
      setError(
        err instanceof ServiceError
          ? `The generation service answered: ${err.message}`
          : `Request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setWorking(false);
    }
  }, [working, prompt, adapter, duration, seed]);

  return (
    <main className="pb-24">
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
              Generate with the MusicGen adapters fine-tuned on the qaraami corpus and served on this
              machine. Only the models running right now are listed. Every piece is labelled with the
              adapter and the corpus it was trained on; the source recordings are never distributed,
              and generated pieces stay separate from the archive.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-14">
        <div className="flex flex-col gap-8">
          <Reveal>
            <div className="rounded-2xl border border-line-secondary bg-bg-secondary p-8">
              <label htmlFor="gen-prompt" className="font-body text-sm font-semibold text-ink-primary">
                Describe the music
              </label>
              <textarea
                id="gen-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                maxLength={400}
                placeholder="e.g. Somali qaraami led by the oud, moderate tempo, pentatonic melody…"
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

              <fieldset className="mt-6">
                <legend className="font-body text-sm font-semibold text-ink-primary">Model</legend>
                {status.kind === 'loading' ? (
                  <p className="mt-2 font-body text-sm text-ink-secondary">Asking the generation service what it is serving…</p>
                ) : null}
                {status.kind === 'down' ? (
                  <p className="mt-2 font-body text-sm text-[#e07070]" role="alert">
                    {status.message}
                  </p>
                ) : null}
                {status.kind === 'ready' ? (
                  <>
                    <p className="mt-1 font-body text-xs text-ink-tertiary">
                      served on {status.service.device} at {status.service.url}; one card per loaded adapter, timed on its last generations
                    </p>
                    <div className="mt-2 grid gap-3 sm:grid-cols-3">
                      {status.cards.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setAdapter(c.id)}
                          aria-pressed={adapter === c.id}
                          className={`rounded-xl border p-4 text-left transition-colors ${
                            adapter === c.id
                              ? 'border-amber bg-amber/10'
                              : 'border-line-primary bg-bg-tertiary hover:border-amber/50'
                          }`}
                        >
                          <span className="block font-body font-semibold text-ink-primary">{c.title}</span>
                          <span className="mt-1 block font-body text-sm text-amber">{c.subtitle}</span>
                          <span className="mt-1 block font-body text-xs text-ink-secondary">{c.note}</span>
                          <span className="mt-1 block font-body text-xs text-ink-tertiary">{c.timing}</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </fieldset>

              <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
                <div className="flex flex-wrap items-end gap-4">
                  <label className="flex flex-col font-body text-sm text-ink-secondary">
                    Seconds
                    <select
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                      className="mt-1 rounded-lg border border-line-primary bg-bg-tertiary px-3 py-2 text-ink-primary"
                    >
                      {DURATIONS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col font-body text-sm text-ink-secondary">
                    Seed
                    <input
                      type="number"
                      min={0}
                      value={seed}
                      onChange={(e) => setSeed(Math.max(0, Number(e.target.value) || 0))}
                      className="mt-1 w-28 rounded-lg border border-line-primary bg-bg-tertiary px-3 py-2 text-ink-primary"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={working || status.kind !== 'ready' || !adapter || prompt.trim().length < 3}
                  className="rounded-xl bg-amber px-7 py-3 font-body font-semibold text-bg-primary transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {working ? 'Generating…' : 'Generate'}
                </button>
              </div>
              {working ? (
                <p className="mt-4 font-body text-sm text-ink-secondary">
                  Generating about a second of audio per second on this machine; PCS is scored on the result.
                </p>
              ) : null}
              {error ? (
                <p className="mt-4 font-body text-sm text-[#e07070]" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </Reveal>

          {result ? (
            <Reveal>
              <div className="rounded-2xl border border-line-secondary bg-bg-secondary p-8">
                <div className="flex flex-col gap-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <h2 className="font-display text-2xl text-ink-primary">Generated piece</h2>
                    <span className="rounded-full border border-amber/40 px-3 py-1 font-body text-xs uppercase tracking-wider text-amber">
                      generated · {result.adapter}
                    </span>
                  </div>
                  <audio controls src={`${AI_URL}${result.audio}`} className="w-full">
                    Your browser cannot play this audio.
                  </audio>
                  <dl className="grid gap-1 font-body text-sm text-ink-secondary sm:grid-cols-3">
                    <div>
                      <dt className="text-ink-tertiary">Pentatonic conformity (PCS)</dt>
                      <dd className="text-ink-primary">
                        {result.pcs?.pcs !== undefined ? result.pcs.pcs.toFixed(3) : 'not scored'}
                        {result.pcs?.voiced_fraction !== undefined ? ` · voiced ${result.pcs.voiced_fraction.toFixed(2)}` : ''}
                        {result.pcs?.tonic ? ` · tonic ${result.pcs.tonic}` : ''}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-tertiary">Length</dt>
                      <dd className="text-ink-primary">{result.duration} s</dd>
                    </div>
                    <div>
                      <dt className="text-ink-tertiary">Time to generate</dt>
                      <dd className="text-ink-primary">
                        {result.total_seconds !== undefined ? `${result.total_seconds.toFixed(1)} s` : '–'}
                      </dd>
                    </div>
                  </dl>
                  {result.provenance ? (
                    <p className="font-body text-xs text-ink-tertiary">{result.provenance}</p>
                  ) : null}
                </div>
              </div>
            </Reveal>
          ) : null}
        </div>
      </section>
    </main>
  );
}
