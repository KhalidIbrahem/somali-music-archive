/**
 * Landing (/) — QaraamiGenAI, cinematic build.
 *
 * Documentary + museum exhibit + research lab: near-black with film-grain
 * warmth, aged-cream paper as the lit object, brass as the only voice of
 * emphasis. Structure per the build brief: hero (silence, then the turn) →
 * the proof (engraving that plays) → four storytelling sections including a
 * waveform-to-notation morph → real stat callouts → a closing that ends on a
 * single held note fading to silence.
 *
 * ALL copy lives in lib/landingCopy.ts with provenance rules — the approved
 * copy bank (QaraamiGen-landing-copy.md) drops into that file when it lands.
 * Identity: concept 1A "The Seal" (fixtures/qaraamigen-logo.dc.html).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata } from 'next';
import Link from 'next/link';
import { HeroScore, type HeroNotes } from '@/components/home/HeroScore';
import { WaveToScore } from '@/components/home/WaveToScore';
import { ClosingNote } from '@/components/home/ClosingNote';
import { QaraamiGenLockup, QaraamiGenMark } from '@/components/brand/QaraamiGenLogo';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { AuthMenu } from '@/components/AuthMenu';
import { DemoPlayer } from '@/components/home/DemoPlayer';
import { RESEARCH_DEMOS } from '@/lib/demos';
import { Reveal } from '@/components/Reveal';
import { landingCopy as copy } from '@/lib/landingCopy';

export const metadata: Metadata = {
  title: 'QaraamiGenAI — before the last tape fades',
  description:
    'For fifty years, Somali Qaraami lived only in performance and on aging cassettes. QaraamiGen is teaching artificial intelligence to hear it, understand it, and write it down — before it’s gone.',
};

const sampleDir = join(process.cwd(), 'public/sample');
const heroDesktop = readFileSync(join(sampleDir, 'hero-desktop.svg'), 'utf8');
const heroMobile = readFileSync(join(sampleDir, 'hero-mobile.svg'), 'utf8');
const heroNotes = JSON.parse(readFileSync(join(sampleDir, 'hero-notes.json'), 'utf8')) as HeroNotes;

export default function Home(): React.JSX.Element {
  return (
    <div className="relative min-h-dvh overflow-x-clip bg-page font-body text-hi">
      {/* film grain — static SVG turbulence, one veil over the whole page */}
      <div aria-hidden className="film-grain print:hidden" />

      {/* Sticky so the menus never leave the top of the screen. z-30 (not z-10
          like main): the account dropdown lives inside this stacking context —
          at equal z the LATER sibling (main) would sit above it and swallow its
          clicks while the pixels showed through. */}
      <header className="sticky top-0 z-30 border-b border-hairline bg-page/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
          <QaraamiGenLockup markSize={28} />
          <nav className="flex items-center gap-5">
            <Link
              href="/daw"
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
            <AuthMenu variant="landing" />
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main className="relative z-10">
        {/* ── Hero: silence, then the turn ─────────────────────────────────── */}
        <section className="mx-auto flex min-h-[82dvh] w-full max-w-4xl flex-col items-start justify-center px-6 py-24">
          <p
            className="hero-enter numeric text-xs tracking-[0.24em] text-accent-state uppercase"
            style={{ '--enter-delay': '0ms' } as React.CSSProperties}
          >
            {copy.hero.kicker}
          </p>
          <h1
            className="hero-enter mt-6 max-w-3xl font-display text-5xl leading-[1.08] sm:text-6xl"
            style={{ '--enter-delay': '90ms' } as React.CSSProperties}
          >
            {copy.hero.headline}
          </h1>
          <p
            className="hero-enter mt-6 max-w-xl text-lg leading-relaxed text-mid"
            style={{ '--enter-delay': '260ms' } as React.CSSProperties}
          >
            {copy.hero.sub}
          </p>
          <p
            className="hero-enter mt-10 font-display text-3xl text-accent-state italic sm:text-4xl"
            style={{ '--enter-delay': '850ms' } as React.CSSProperties}
          >
            {copy.hero.turn}
          </p>
          <ul
            className="hero-enter mt-10 flex flex-wrap gap-x-6 gap-y-2"
            style={{ '--enter-delay': '1100ms' } as React.CSSProperties}
          >
            {copy.hero.pillars.map((pillar) => (
              <li
                key={pillar}
                className="numeric flex items-center gap-2 text-[11px] tracking-[0.16em] text-mid uppercase"
              >
                <span aria-hidden className="h-1 w-1 rounded-full bg-accent-state" />
                {pillar}
              </li>
            ))}
          </ul>
        </section>

        {/* ── The proof: the engraving that plays ──────────────────────────── */}
        <section className="mx-auto w-full max-w-5xl px-6 pb-28">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="numeric text-xs tracking-[0.24em] text-accent-state uppercase">
              {copy.proof.kicker}
            </p>
            <h2 className="mt-4 font-display text-3xl">{copy.proof.title}</h2>
            <p className="mt-3 leading-relaxed text-mid">{copy.proof.body}</p>
          </Reveal>
          <Reveal delay={200} className="mt-10">
            <HeroScore svgDesktop={heroDesktop} svgMobile={heroMobile} notes={heroNotes} />
          </Reveal>
        </section>

        {/* ── Research demos (Stage 2) — the shareable results ─────────────── */}
        <section id="research" className="border-t border-hairline">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-24">
            <Reveal className="max-w-2xl">
              <p className="numeric text-xs tracking-[0.24em] text-accent-state uppercase">
                {copy.demos.kicker}
              </p>
              <h2 className="mt-4 font-display text-3xl">{copy.demos.title}</h2>
              <p className="mt-3 leading-relaxed text-mid">{copy.demos.intro}</p>
            </Reveal>
            {RESEARCH_DEMOS.map((demo, i) => (
              <Reveal key={demo.slug} delay={100 + i * 100}>
                <DemoPlayer demo={demo} />
              </Reveal>
            ))}
            <Reveal delay={200}>
              <div className="flex flex-col items-start justify-between gap-3 rounded-[4px] border border-dashed border-hairline px-6 py-5 sm:flex-row sm:items-center">
                <div>
                  <h3 className="font-display text-lg text-hi">{copy.demos.film.title}</h3>
                  <p className="mt-1 max-w-xl text-sm text-mid">{copy.demos.film.body}</p>
                </div>
                <span className="numeric shrink-0 rounded-full border border-hairline px-3 py-1 text-[11px] tracking-[0.14em] text-low uppercase">
                  {copy.demos.film.badge}
                </span>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── Story ────────────────────────────────────────────────────────── */}
        {copy.sections.map((s, i) => (
          <section key={s.id} className="border-t border-hairline">
            <div
              className={`mx-auto grid w-full max-w-5xl gap-10 px-6 py-24 lg:grid-cols-[5fr_6fr] lg:items-center ${
                i % 2 === 1 ? 'lg:[direction:rtl]' : ''
              }`}
            >
              <Reveal className="lg:[direction:ltr]">
                <p className="numeric text-xs tracking-[0.24em] text-accent-state uppercase">
                  {s.kicker}
                </p>
                <h2 className="mt-4 max-w-lg font-display text-3xl leading-snug">{s.title}</h2>
                <p className="mt-4 max-w-lg leading-relaxed text-mid">{s.body}</p>
              </Reveal>
              <Reveal delay={150} className="min-w-0 lg:[direction:ltr]">
                {s.id === 'writing' && <WaveToScore scoreSvg={heroMobile} />}
                {s.id === 'doubt' && (
                  <div className="rounded-[2px] bg-paper p-8 ring-1 ring-paper-edge">
                    <div className="flex items-end justify-center gap-10">
                      {(
                        [
                          ['bg-confidence-high', '≥ 0.90'],
                          ['bg-confidence-mid', '0.70–0.89'],
                          ['bg-confidence-low', '< 0.70'],
                        ] as const
                      ).map(([cls, label]) => (
                        <div key={label} className="flex flex-col items-center gap-3">
                          <span aria-hidden className={`h-10 w-10 rounded-full ${cls}`} />
                          <span className="numeric text-xs text-confidence-mid">{label}</span>
                        </div>
                      ))}
                    </div>
                    <p className="numeric mt-6 text-center text-[11px] tracking-[0.18em] text-confidence-mid uppercase">
                      the ink is the confidence
                    </p>
                  </div>
                )}
                {s.id === 'tapes' && (
                  <div className="grain-reveal relative overflow-hidden rounded-[2px] ring-1 ring-hairline">
                    <div className="flex h-56 items-center justify-center bg-chrome-1">
                      <QaraamiGenMark size={96} className="text-low" tone="mono" />
                    </div>
                    <p className="numeric absolute bottom-3 left-4 text-[10px] tracking-[0.18em] text-low uppercase">
                      cassette-era masters · decaying
                    </p>
                  </div>
                )}
                {s.id === 'archive' && (
                  <div className="flex flex-col gap-3">
                    <Link
                      href="/listen"
                      className="group flex items-center justify-between rounded-[4px] border border-hairline bg-chrome-1 px-5 py-4 transition-colors hover:border-accent-state focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
                    >
                      <span className="text-sm text-hi">The listening room</span>
                      <span className="numeric text-xs text-low group-hover:text-accent-state">
                        18 recordings · sources stated
                      </span>
                    </Link>
                    <Link
                      href="/studio"
                      className="group flex items-center justify-between rounded-[4px] border border-hairline bg-chrome-1 px-5 py-4 transition-colors hover:border-accent-state focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
                    >
                      <span className="text-sm text-hi">The transcription studio</span>
                      <span className="numeric text-xs text-low group-hover:text-accent-state">
                        one cursor · score, waveform, sound
                      </span>
                    </Link>
                  </div>
                )}
              </Reveal>
            </div>
          </section>
        ))}

        {/* ── Stats: museum labels, not dashboards ─────────────────────────── */}
        <section className="border-t border-hairline">
          <div className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-x-8 gap-y-12 px-6 py-24 md:grid-cols-4">
            {copy.stats.map((stat, i) => (
              <Reveal key={stat.label} delay={i * 100}>
                <p className="numeric text-4xl text-hi">{stat.value}</p>
                <p className="mt-2 max-w-[22ch] text-xs leading-relaxed text-mid">{stat.label}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Closing: the held note ───────────────────────────────────────── */}
        <section className="border-t border-hairline">
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-8 px-6 py-28 text-center">
            <Reveal>
              <h2 className="font-display text-3xl leading-snug sm:text-4xl">
                {copy.closing.title}
              </h2>
              <p className="mt-4 text-mid">{copy.closing.body}</p>
            </Reveal>
            <Reveal delay={150}>
              <div className="flex flex-wrap items-center justify-center gap-4">
                <Link
                  href="/daw"
                  className="flex h-12 w-fit items-center rounded-[4px] bg-accent-state px-6 text-lg font-bold text-page transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none motion-reduce:transition-none"
                >
                  {copy.closing.primaryCta}
                </Link>
                <Link
                  href="/listen"
                  className="flex h-12 w-fit items-center rounded-[4px] border border-mid px-6 text-base text-mid transition-colors hover:border-hi hover:text-hi focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
                >
                  {copy.closing.secondaryCta}
                </Link>
              </div>
            </Reveal>
            <Reveal delay={300} className="mt-8">
              <ClosingNote hint={copy.closing.noteHint} />
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-hairline">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-8 text-xs text-low sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <QaraamiGenMark size={20} tone="mono" className="text-mid" />
            <p>
              QaraamiGenAI — built in Minneapolis for the diaspora.{' '}
              <span className="text-mid">{copy.credit}.</span>
            </p>
          </div>
          <p>
            Recordings remain with their rights holders. Transcriptions carry their own uncertainty.
          </p>
        </div>
      </footer>
    </div>
  );
}
