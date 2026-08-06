/**
 * Landing (/) — one claim, one engraved excerpt that plays (B1-07/10/11, §4).
 *
 * The hero is the hand-curated excerpt from fixtures/hero-excerpt.mei,
 * engraved by scripts/build-hero.mjs into two inline SVG variants (desktop:
 * both phrases; mobile: two systems at legible scale). Inline because the
 * playhead and reached-note ink need real glyph nodes — the excerpt is small
 * enough (~60KB total) that this stays far under the 500KB pre-interaction
 * budget; the audio never loads until the first press. No stock imagery, no
 * feature grid; the score is the argument.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata } from 'next';
import Link from 'next/link';
import { HeroScore, type HeroNotes } from '@/components/home/HeroScore';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

export const metadata: Metadata = {
  title: 'Somali Music Archive — qaraami, written down',
  description:
    'Qaraami lived in voices and reels, never on paper. This archive transcribes the recordings that survive into engraved notation, and prints how sure it is, note by note.',
};

const sampleDir = join(process.cwd(), 'public/sample');
const heroDesktop = readFileSync(join(sampleDir, 'hero-desktop.svg'), 'utf8');
const heroMobile = readFileSync(join(sampleDir, 'hero-mobile.svg'), 'utf8');
const heroNotes = JSON.parse(readFileSync(join(sampleDir, 'hero-notes.json'), 'utf8')) as HeroNotes;

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
              Qaraami lived in voices and reels, never on paper.
            </h1>
            <p className="mt-6 max-w-md text-base leading-relaxed text-mid">
              This archive writes it down: the recordings that survive, transcribed into engraved
              notation that prints how sure it is, note by note.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/studio"
                className="flex h-12 w-fit items-center rounded-[4px] bg-accent-state px-6 text-lg font-bold text-page transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none motion-reduce:transition-none"
              >
                Open the studio
              </Link>
              <Link
                href="/listen"
                className="flex h-12 w-fit items-center rounded-[4px] border border-mid px-6 text-base text-mid transition-colors hover:border-hi hover:text-hi focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
              >
                Enter the listening room
              </Link>
            </div>
          </div>

          <div className="min-w-0">
            <HeroScore svgDesktop={heroDesktop} svgMobile={heroMobile} notes={heroNotes} />
            <p className="mt-3 text-xs leading-relaxed text-low">
              Press play: the excerpt sounds an octave below written pitch, as the clef says it
              should. A full transcription with the pipeline&rsquo;s own confidence ink lives in{' '}
              <Link
                href="/studio"
                className="text-accent-live underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
              >
                the studio
              </Link>
              .
            </p>
          </div>
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
