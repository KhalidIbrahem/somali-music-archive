/**
 * PortfolioHub (/portfolio, portfolio-v1): the one link for a reviewer with ten
 * minutes. Six stops, each a page that works with no login and no setup, with
 * the headline number of each read from the same JSON files those pages use.
 * Server component. The demo video slot is a placeholder until it is recorded.
 */

import Link from 'next/link';
import results from '@/lib/results-summary.json';
import showcase from '@/lib/transcription-showcase.json';
import pairs from '@/lib/listen-pairs.json';
import grid from '@/lib/generate-grid.json';
import dspDemo from '@/lib/dsp-demo.json';

const REPO = 'https://github.com/KhalidIbrahem/somali-music-archive';
const GEN_LIVE = pairs.pairs.length > 0 && Object.keys(grid.clips).length > 0;
const DSP_LIVE = dspDemo.source.kind !== 'synthetic';
const large = results.scaling.find((r) => r.key === 'large');
const seventh = showcase.pool.intervals.find((i) => i.interval === 1000);

interface Stop {
  readonly minutes: string;
  readonly title: string;
  readonly body: string;
  readonly links: ReadonlyArray<{ readonly href: string; readonly label: string }>;
  readonly fact: string;
}

const STOPS: readonly Stop[] = [
  {
    minutes: '2 min',
    title: 'Turn a recording into sheet music',
    body: 'In your browser: one click on a sample, or your own file or microphone. The melody is written out with the five-note scale and the tuning measured from the audio itself.',
    links: [{ href: '/transcribe', label: 'Recording to sheet music' }],
    fact: `${Math.round(results.qormada.shareOfHuman * 100)} % of the agreement between two human annotators on a public benchmark`,
  },
  {
    minutes: '2 min',
    title: 'Read three scores',
    body: 'Automatic transcriptions of qaraami with playback, and what the measured tuning shows about a five-note scale that is not tuned like a piano.',
    links: [{ href: '/scores', label: 'Scores and tuning findings' }],
    fact: seventh
      ? `Minor seventh ${seventh.mean > 0 ? '+' : ''}${seventh.mean.toFixed(1)} cents over ${seventh.n} recordings`
      : '',
  },
  {
    // Linked only once the page runs on a real recording (lib/dsp-demo.json says which).
    minutes: DSP_LIVE ? '2 min' : 'in progress',
    title: 'Separation and restoration',
    body: DSP_LIVE
      ? 'A recording split into oud and voice, and tape noise taken off, each scored against the true take.'
      : 'Original, extracted oud, extracted voice and remix; and noisy tape, noise and restored, on an oud recording made for this project. The page will be linked here when the recording is in.',
    links: DSP_LIVE ? [{ href: '/separation', label: 'Original, extracted, restored' }] : [],
    fact: DSP_LIVE
      ? `Oud: ${dspDemo.separation.oud.mixtureSiSdr.toFixed(1)} dB in the mixture, ${dspDemo.separation.oud.separatedSiSdr.toFixed(1)} dB extracted`
      : '',
  },
  {
    minutes: '2 min',
    title: 'Check the numbers',
    body: 'Held-out gains of the fine-tuned models with 95 % intervals, the blind listening results beside them, and the transcription pool in one table.',
    links: [{ href: '/results', label: 'Evaluation summary' }],
    fact: large
      ? `Large model: +${large.improvement.toFixed(3)} nats [${large.ci95[0]?.toFixed(3)}, ${large.ci95[1]?.toFixed(3)}] on ${large.testSongs} unseen songs`
      : '',
  },
  {
    minutes: '2 min',
    title: 'Read the code',
    body: 'Training harness, evaluation scripts, the transcription pipeline and this site are open source. Two defects found along the way in the MusicGen implementation of huggingface/transformers were reported upstream, each with a one-minute reproducer.',
    links: [
      { href: REPO, label: 'Repository' },
      {
        href: 'https://github.com/huggingface/transformers/issues/49094',
        label: 'Issue #49094: dropout breaks fine-tuning',
      },
      {
        href: 'https://github.com/huggingface/transformers/issues/49095',
        label: 'Issue #49095: training call fails on every checkpoint',
      },
      { href: 'https://huggingface.co/spaces/khalidibra/qaraamigen', label: 'Hugging Face Space' },
    ],
    fact: 'Both defects still reproduce on the main branch (checked 2026-11-21)',
  },
  {
    minutes: 'work in progress',
    title: 'Generation',
    body: GEN_LIVE
      ? 'MusicGen fine-tuned on oud recordings. The loss improves on unseen songs; the audio is not there yet, and the blind tests say so. The same prompt and seed through the base model and the fine-tuned one, side by side.'
      : 'MusicGen fine-tuned on oud recordings. The loss improves on unseen songs; the audio is not there yet, and the blind tests say so. The numbers and the blind sittings are on the results page.',
    links: GEN_LIVE
      ? [
          { href: '/listen#pairs', label: 'Before and after pairs' },
          { href: '/generate', label: 'Prompt and seed picker' },
        ]
      : [{ href: '/results', label: 'Loss and blind listening' }],
    fact: GEN_LIVE
      ? `${pairs.pairs.length} pairs and ${Object.keys(grid.clips).length} picker clips, numbers for both sides shown`
      : '',
  },
];

function isExternal(href: string): boolean {
  return href.startsWith('http');
}

export function PortfolioHub(): React.JSX.Element {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <p className="font-body text-sm tracking-[0.3em] text-amber uppercase">Portfolio</p>
      <h1 className="mt-2 font-display text-3xl text-ink-primary sm:text-4xl">
        QaraamiGen in ten minutes
      </h1>
      <p className="mt-4 font-body text-ink-secondary">
        Somali qaraami is an oud-led song tradition passed on by ear, with almost no written scores
        and a tuning no piano has. This project builds the tools to study it with computation:
        transcription that writes a recording out as sheet music with its measured scale, generation
        models fine-tuned on Somali recordings, and an evaluation that reports what the ear says
        next to what the loss says. It is built and maintained by Khalid Ibrahim.
      </p>
      <p className="mt-3 font-body text-sm text-ink-secondary">
        Everything below opens with no login and no setup.
      </p>

      <ol className="mt-8 flex flex-col gap-4">
        {STOPS.map((s, i) => (
          <li
            key={s.title}
            className="rounded-2xl border border-line-secondary bg-bg-secondary p-5 sm:p-6"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <h2 className="font-display text-xl text-ink-primary">
                {i + 1}. {s.title}
              </h2>
              <span className="font-body text-xs tracking-wider text-ink-secondary uppercase">
                {s.minutes}
              </span>
            </div>
            <p className="mt-2 font-body text-sm text-ink-secondary">{s.body}</p>
            <div className={s.links.length ? 'mt-4 flex flex-wrap gap-2' : 'hidden'}>
              {s.links.map((l, j) =>
                isExternal(l.href) ? (
                  <a
                    key={l.href}
                    href={l.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center rounded-lg border border-line-primary px-4 py-2 font-body text-sm text-ink-secondary transition-colors hover:text-ink-primary"
                  >
                    {l.label} ↗
                  </a>
                ) : (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={`inline-flex min-h-11 items-center rounded-lg px-4 py-2 font-body text-sm font-semibold transition-colors ${
                      j === 0
                        ? 'bg-amber text-bg-primary hover:opacity-90'
                        : 'border border-amber/40 text-amber hover:bg-amber hover:text-bg-primary'
                    }`}
                  >
                    {l.label}
                  </Link>
                ),
              )}
            </div>
            {s.fact ? <p className="mt-3 font-body text-xs text-ink-secondary">{s.fact}</p> : null}
          </li>
        ))}
      </ol>

      <section className="mt-8 rounded-2xl border border-dashed border-line-primary p-5 sm:p-6">
        <h2 className="font-display text-xl text-ink-primary">Demo video</h2>
        <p className="mt-2 font-body text-sm text-ink-secondary">
          Placeholder. A three-minute screen recording of the tools above will be linked here.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="font-display text-xl text-ink-primary">Rights</h2>
        <p className="mt-2 font-body text-sm text-ink-secondary">
          No archival recording is served on this site. Every clip you can play is AI model output
          from models trained only on consented recordings, or is synthesised. Models trained on
          archive cassettes are reported as numbers only.{' '}
          <a
            href={`${REPO}/blob/master/docs/DATA_PROVENANCE.md`}
            target="_blank"
            rel="noreferrer"
            className="text-amber underline underline-offset-4"
          >
            Data provenance
          </a>
        </p>
      </section>
    </main>
  );
}
