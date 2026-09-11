/**
 * GenerateExamples (/generate with NEXT_PUBLIC_AI_SERVICE_MODE=off).
 *
 * The public site has no generation service behind it: the models run on the
 * research workstation. This page shows six clips those adapters produced,
 * each with its model, checkpoint, prompt and seed, and the line every audio
 * output carries: which corpus the adapter learned from, and that the source
 * recordings are not distributed. Server component; the only interaction is
 * the browser's own audio control.
 */

import { GENERATED_EXAMPLES, NOT_DISTRIBUTED } from '@/lib/demoExamples';
import { Reveal } from '@/components/Reveal';

export function GenerateExamples(): React.JSX.Element {
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
              Generation runs on the research workstation, not on this site. Below are six clips
              from the fine-tuned MusicGen adapters, generated ahead of time: the same prompt goes
              to the base model and to the adapter with the same seed, and only the adapter side is
              played here. Every clip is labelled with the corpus its adapter learned from.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-14">
        <ol className="flex flex-col gap-6">
          {GENERATED_EXAMPLES.map((clip, i) => (
            <li key={clip.id}>
              <Reveal delay={i * 60}>
                <article className="rounded-2xl border border-line-secondary bg-bg-secondary p-6 sm:p-8">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                    <h2 className="font-display text-2xl text-ink-primary">{clip.model}</h2>
                    <span className="rounded-full border border-amber/40 px-3 py-1 font-body text-xs uppercase tracking-wider text-amber">
                      generated · {clip.adapter}
                    </span>
                  </div>
                  <p className="mt-3 font-body text-ink-secondary">
                    <span className="text-ink-tertiary">Prompt: </span>
                    {clip.prompt}
                  </p>
                  <audio controls preload="none" src={clip.file} className="mt-4 w-full">
                    Your browser cannot play this audio.
                  </audio>
                  <dl className="mt-4 grid gap-x-6 gap-y-1 font-body text-sm text-ink-secondary sm:grid-cols-3">
                    <div>
                      <dt className="text-ink-tertiary">Checkpoint</dt>
                      <dd className="text-ink-primary">{clip.checkpoint}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-tertiary">Seed</dt>
                      <dd className="text-ink-primary">
                        {clip.seed}, shared with the base-model clip
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-tertiary">Length</dt>
                      <dd className="text-ink-primary">{clip.durationSec} s</dd>
                    </div>
                  </dl>
                  <p className="mt-4 font-body text-xs text-ink-tertiary">
                    Adapter trained on {clip.corpus}. {NOT_DISTRIBUTED}
                  </p>
                </article>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
