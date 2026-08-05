/**
 * Landing (/) — one claim, one real engraved score (B1-07, §4).
 *
 * The hero is page one of the sample session's actual engraving, pre-rendered
 * to a static SVG by scripts/build-sample-session.mjs with the confidence ink
 * baked in — the archive's signature is visible with zero JavaScript. It
 * ships as an image, not inline markup: the document stays tiny and the
 * manuscript paints without the DOM cost of ~3,600 SVG nodes. No stock
 * imagery, no feature grid; the score is the argument.
 */

import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

export const metadata: Metadata = {
  title: 'Somali Music Archive — the first AI-powered archive of Somali traditional music',
  description:
    'Qaraami-era recordings transcribed into engraved notation by a pipeline that prints its certainty in the ink. Preserved. Taught. Shared.',
};

export default function Home(): React.JSX.Element {
  return (
    <div className="min-h-dvh bg-page font-body text-hi">
      <header className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
        <p className="font-display text-base tracking-wide">Somali Music Archive</p>
        <nav className="flex items-center gap-5">
          <Link
            href="/studio"
            className="rounded-[4px] text-sm text-mid transition-colors hover:text-hi focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
          >
            Studio
          </Link>
          <Link
            href="/listen"
            className="hidden rounded-[4px] text-sm text-mid transition-colors hover:text-hi focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none sm:block"
          >
            Listening room
          </Link>
          <Link
            href="/login"
            className="rounded-[4px] text-sm text-mid transition-colors hover:text-hi focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
          >
            Sign in
          </Link>
          <ThemeToggle />
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6">
        {/* ── The claim and the evidence ──────────────────────────────────── */}
        <section className="grid gap-12 py-14 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:py-24">
          <div>
            <h1 className="font-display text-4xl leading-[1.12] sm:text-5xl">
              The first AI-powered archive of Somali traditional music.
            </h1>
            <p className="mt-6 max-w-md text-base leading-relaxed text-mid">
              Qaraami lived in voices and reels, never on paper. The archive transcribes the
              recordings that survive into engraved notation — and prints how sure it is, note by
              note.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/studio"
                className="flex h-12 items-center rounded-[4px] bg-accent-state px-6 text-lg font-bold text-page transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none motion-reduce:transition-none"
              >
                Open the studio
              </Link>
              <Link
                href="/listen"
                className="flex h-12 items-center rounded-[4px] border border-hairline px-6 text-base text-mid transition-colors hover:text-hi focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
              >
                Enter the listening room
              </Link>
            </div>
          </div>

          <figure className="min-w-0">
            <div className="rounded-[2px] bg-paper p-4 shadow-2xl ring-1 ring-paper-edge sm:p-6">
              {/* unoptimized: the asset is already an SVG; the optimizer would
                  refuse it and it needs no resizing. */}
              <Image
                src="/sample/hero.svg"
                alt="Engraved opening page of a transcribed qaraami vocal line — low-confidence notes printed in lighter ink"
                width={816}
                height={920}
                priority
                unoptimized
                className="block h-auto w-full"
              />
            </div>
            <figcaption className="mt-3 text-xs leading-relaxed text-low">
              A real transcription from the archive — voice, pentatonic root A, 106 BPM,
              beat-tracked. The faint notes are the model&rsquo;s own doubt, printed.{' '}
              <Link
                href="/studio"
                className="text-accent-live underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
              >
                Open it in the studio
              </Link>
            </figcaption>
          </figure>
        </section>

        {/* ── How it works — three sentences, no grid ─────────────────────── */}
        <section className="max-w-2xl border-t border-hairline py-14">
          <h2 className="font-display text-2xl">Written down, honestly</h2>
          <p className="mt-4 leading-relaxed text-mid">
            Upload a recording and the pipeline separates the voice from the band, finds the
            pentatonic root, scale degrees, and beat grid, then engraves the melody as sheet music
            you can play, print, or export. Where the model is less certain, it prints lighter ink
            instead of pretending — the score never claims more than the recording gives it.
          </p>
          <p className="mt-3 leading-relaxed text-mid">
            Solo recordings give the best results. Multiple instruments playing at once are
            transcribed with lower accuracy.
          </p>
        </section>
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-6 py-8 text-xs text-low sm:flex-row sm:items-center sm:justify-between">
          <p>Somali Music Archive — built in Minneapolis for the diaspora.</p>
          <p>
            Recordings remain with their rights holders. Transcriptions carry their own uncertainty.
          </p>
        </div>
      </footer>
    </div>
  );
}
