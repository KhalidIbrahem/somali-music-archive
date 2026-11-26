'use client';

/**
 * GeneratePicker — the top of the public /generate page (portfolio-v1).
 * The model does not run on the public site, so this is not live generation
 * and says so: every prompt x seed below was generated ahead of time on the
 * research workstation with exactly the settings shown, on the published base
 * model and on the fine-tuned one. Picking a prompt and a seed plays the stored
 * result at once. Grid and numbers: lib/generate-grid.json
 * (apps/ai-service/scripts/generate_grid_build.py). Releasable models only.
 */

import { useState } from 'react';
import grid from '@/lib/generate-grid.json';

interface Clip {
  readonly file: string;
  readonly pcs: number | null;
  readonly voiced: number | null;
}
interface Grid {
  readonly durationSec: number;
  readonly cfg: number;
  readonly medianGenerationSeconds: number;
  readonly labels: { readonly base: string; readonly tuned: string };
  readonly prompts: ReadonlyArray<{
    readonly id: number;
    readonly label: string;
    readonly prompt: string;
  }>;
  readonly seeds: readonly number[];
  readonly clips: Readonly<Record<string, Clip>>;
}

const GRID: Grid = grid;

function chip(active: boolean): string {
  return `min-h-11 rounded-lg border px-3 py-2 font-body text-sm transition-colors ${
    active
      ? 'border-amber bg-amber font-semibold text-bg-primary'
      : 'border-line-primary text-ink-secondary hover:text-ink-primary'
  }`;
}

function Side({
  title,
  label,
  clip,
}: {
  readonly title: string;
  readonly label: string;
  readonly clip: Clip | undefined;
}): React.JSX.Element {
  return (
    <div className="rounded-xl border border-line-secondary bg-bg-tertiary p-4">
      <h3 className="font-display text-lg text-ink-primary">{title}</h3>
      <p className="font-body text-xs text-ink-secondary">{label}</p>
      {clip ? (
        <>
          {/* key: a new clip must reload the element, not keep the old one playing */}
          <audio key={clip.file} controls preload="none" src={clip.file} className="mt-3 w-full">
            Your browser cannot play this audio.
          </audio>
          <p className="mt-2 font-body text-xs text-ink-secondary">
            Melody {clip.voiced === null ? '–' : `${Math.round(clip.voiced * 100)} %`} · PCS{' '}
            {clip.pcs === null ? '–' : clip.pcs.toFixed(2)}
          </p>
        </>
      ) : (
        <p className="mt-3 font-body text-sm text-ink-secondary">No clip for this choice.</p>
      )}
    </div>
  );
}

export function GeneratePicker(): React.JSX.Element | null {
  const [promptId, setPromptId] = useState<number>(GRID.prompts[0]?.id ?? 0);
  const [seed, setSeed] = useState<number>(GRID.seeds[0] ?? 0);
  const prompt = GRID.prompts.find((p) => p.id === promptId);
  const key = `p${promptId}_s${seed}`;
  // No clips: held until they have been listened to and approved (apps/web/held).
  if (Object.keys(GRID.clips).length === 0) return null;
  return (
    <section aria-labelledby="picker-title" className="mx-auto w-full max-w-4xl px-4 pt-14 sm:px-6">
      <div className="rounded-2xl border border-amber/40 bg-bg-secondary p-5 sm:p-8">
        <h2 id="picker-title" className="font-display text-2xl text-ink-primary">
          Pick a prompt and a seed
        </h2>
        <p className="mt-2 max-w-2xl font-body text-sm text-ink-secondary">
          You hear what the model made for exactly that prompt and seed: once from MusicGen as
          published, once with this project&apos;s oud adapter.{' '}
          <span className="text-ink-primary">
            These {Object.keys(GRID.clips).length} clips were generated ahead of time
          </span>{' '}
          on the research workstation (about {Math.round(GRID.medianGenerationSeconds)} seconds
          each); the model itself does not run on this public site.
        </p>

        <p className="mt-5 font-body text-xs tracking-wider text-ink-secondary uppercase">Prompt</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {GRID.prompts.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={p.id === promptId}
              onClick={() => setPromptId(p.id)}
              className={chip(p.id === promptId)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <p className="mt-4 font-body text-xs tracking-wider text-ink-secondary uppercase">Seed</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {GRID.seeds.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={s === seed}
              onClick={() => setSeed(s)}
              className={chip(s === seed)}
            >
              {s}
            </button>
          ))}
        </div>

        <p className="mt-4 font-body text-sm text-ink-secondary">
          <span className="text-ink-tertiary">Full prompt: </span>
          {prompt?.prompt}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Side title="Base model" label={GRID.labels.base} clip={GRID.clips[`${key}_base`]} />
          <Side title="Fine-tuned" label={GRID.labels.tuned} clip={GRID.clips[`${key}_tuned`]} />
        </div>

        <p className="mt-4 font-body text-xs text-ink-secondary">
          AI model output, not recordings. {GRID.durationSec} seconds, guidance {GRID.cfg}, one clip
          at a time. Nothing was picked: every prompt and seed of the grid is here, good and bad. A
          different seed gives a different melody for the same prompt.
        </p>
      </div>
    </section>
  );
}
