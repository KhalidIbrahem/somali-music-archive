/**
 * Landing page (SESSION "web landing", ARCHITECTURE.md §7 identity).
 *
 * Archival dignity meets modern clarity: Playfair display type, oud-wood amber on
 * near-black, generous space. A Server Component — no interactivity, just links.
 * The genre roll is pulled from @sma/constants so the copy can never advertise a
 * tradition the platform does not actually recognise.
 */

import Link from 'next/link';
import { GENRE_DESCRIPTORS, GENRES } from '@sma/constants';
import { SiteHeader, LogoMark } from '@/components/SiteHeader';
import { Reveal } from '@/components/Reveal';

const STATS = [
  { value: '605', label: 'Recordings preserved' },
  { value: '47', label: 'Artists honoured' },
  { value: '1955', label: 'Earliest recording' },
];

const FEATURES = [
  {
    id: 'preserve',
    icon: <ArchiveIcon />,
    title: 'Preserve',
    body: 'Field recordings, radio tapes, and family cassettes — cleaned, catalogued, and stored permanently with full cultural provenance.',
  },
  {
    id: 'learn',
    icon: <LearnIcon />,
    title: 'Learn',
    body: 'Guided lessons on the maqaam, the poetry, and the instruments — so a new generation can carry the tradition forward, not just hear it.',
  },
  {
    id: 'research',
    icon: <ResearchIcon />,
    title: 'Research',
    body: 'AI-annotated pitch, scale, and lyric data, opened to ethnomusicologists worldwide through a documented research API.',
  },
];

const STEPS = [
  {
    icon: <UploadIcon />,
    title: 'Contribute a recording',
    body: 'Elders, collectors, and artists upload audio directly and securely, with the story behind each piece.',
  },
  {
    icon: <SparkIcon />,
    title: 'AI annotates it',
    body: 'Transcription, pitch tracking, and Somali scale analysis run automatically, turning audio into structured knowledge.',
  },
  {
    icon: <ShareIcon />,
    title: 'The world listens',
    body: 'Curated recordings reach the diaspora, students, and researchers — searchable, teachable, and permanent.',
  },
];

export default function Home(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-bg-primary text-ink-primary">
      <SiteHeader active="Home" />

      <main>
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[42rem] rounded-full bg-amber/10 blur-3xl animate-glow-drift"
          />
          <div className="mx-auto flex max-w-4xl flex-col items-center gap-8 px-6 py-28 text-center">
            <p
              className="animate-fade-up font-body text-sm uppercase tracking-[0.25em] text-amber"
              style={{ animationDelay: '80ms' }}
            >
              AI-powered cultural preservation
            </p>
            <h1
              className="animate-fade-up font-display text-6xl leading-[1.05] text-ink-primary sm:text-7xl"
              style={{ animationDelay: '180ms' }}
            >
              Somali Music Archive
            </h1>
            <p
              className="animate-fade-up max-w-2xl font-body text-xl leading-relaxed text-ink-secondary"
              style={{ animationDelay: '300ms' }}
            >
              <span className="text-ink-primary">
                Muusigga hidaha Soomaalida — la keydiyay, la baray, la wadaagay.
              </span>
              <br />
              The music of our ancestors, preserved forever and opened to the world.
            </p>
            <div
              className="animate-fade-up mt-2 flex flex-col gap-3 sm:flex-row"
              style={{ animationDelay: '420ms' }}
            >
              <Link
                href="/listen"
                className="rounded-xl bg-amber px-7 py-3 font-body font-semibold text-bg-primary transition-transform hover:-translate-y-0.5"
              >
                Enter the listening room
              </Link>
              <Link
                href="/register"
                className="rounded-xl border border-line-primary px-7 py-3 font-body font-semibold text-ink-primary transition-colors hover:border-amber hover:text-amber"
              >
                Create an account
              </Link>
            </div>
          </div>
        </section>

        {/* ── Stats bar ────────────────────────────────────────────────────── */}
        <section className="border-y border-line-secondary bg-bg-secondary">
          <div className="mx-auto grid max-w-4xl grid-cols-1 divide-y divide-line-secondary px-6 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {STATS.map((stat, i) => (
              <Reveal key={stat.label} delay={i * 110}>
                <div className="flex flex-col items-center gap-1 py-8">
                  <span className="font-display text-5xl text-amber">{stat.value}</span>
                  <span className="font-body text-sm uppercase tracking-wider text-ink-secondary">
                    {stat.label}
                  </span>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── The two rooms — listening + library ──────────────────────────── */}
        <section className="mx-auto max-w-6xl px-6 pt-24">
          <div className="grid gap-6 md:grid-cols-2">
            <Reveal>
              <Link
                href="/listen"
                className="group flex h-full flex-col gap-4 overflow-hidden rounded-2xl border border-line-secondary bg-bg-secondary p-10 transition-colors hover:border-amber/50"
              >
                <span className="eq" aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
                <h3 className="font-display text-3xl text-ink-primary group-hover:text-amber">
                  The Listening Room
                </h3>
                <p className="font-body leading-relaxed text-ink-secondary">
                  Archived history, playing now — restored takes from digitised cassettes,
                  1964–1976. Theatre songs, flag songs, and qaraami voices, looping softly.
                </p>
                <span className="mt-auto font-body text-sm font-semibold text-amber">
                  Dhageyso — start listening →
                </span>
              </Link>
            </Reveal>
            <Reveal delay={120}>
              <Link
                href="/library"
                className="group flex h-full flex-col gap-4 overflow-hidden rounded-2xl border border-line-secondary bg-bg-secondary p-10 transition-colors hover:border-amber/50"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber/10 text-amber">
                  <BooksIcon />
                </span>
                <h3 className="font-display text-3xl text-ink-primary group-hover:text-amber">
                  The Library
                </h3>
                <p className="font-body leading-relaxed text-ink-secondary">
                  Scanned books of Somali music sheets and songbooks — upload a found volume and it
                  is preserved beside the recordings it describes.
                </p>
                <span className="mt-auto font-body text-sm font-semibold text-amber">
                  Maktabadda — open the shelf →
                </span>
              </Link>
            </Reveal>
          </div>
        </section>

        {/* ── Feature cards ────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-6 py-24">
          <div className="grid gap-6 md:grid-cols-3">
            {FEATURES.map((feature, i) => (
              <Reveal key={feature.id} delay={i * 110}>
                <article
                  id={feature.id}
                  className="flex h-full scroll-mt-24 flex-col gap-4 rounded-2xl border border-line-secondary bg-bg-secondary p-8 transition-all hover:-translate-y-1 hover:border-amber/40"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber/10 text-amber">
                    {feature.icon}
                  </span>
                  <h3 className="font-display text-2xl text-ink-primary">{feature.title}</h3>
                  <p className="font-body leading-relaxed text-ink-secondary">{feature.body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── The traditions (from the shared constant source of truth) ────── */}
        <section className="mx-auto max-w-6xl px-6 pb-24">
          <h2 className="mb-8 text-center font-display text-3xl text-ink-primary">
            The traditions we carry
          </h2>
          <div className="flex flex-wrap justify-center gap-3">
            {GENRES.filter((g) => g !== 'other').map((g) => (
              <span
                key={g}
                title={GENRE_DESCRIPTORS[g].description}
                className="rounded-full border border-line-primary bg-bg-tertiary px-4 py-2 font-body text-sm text-ink-secondary"
              >
                {GENRE_DESCRIPTORS[g].label}
              </span>
            ))}
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <section className="border-t border-line-secondary bg-bg-secondary">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <h2 className="mb-16 text-center font-display text-3xl text-ink-primary">
              How it works
            </h2>
            <ol className="grid gap-10 md:grid-cols-3">
              {STEPS.map((step, i) => (
                <li key={step.title}>
                  <Reveal delay={i * 130}>
                    <div className="flex flex-col items-center gap-4 text-center">
                      <span className="flex h-14 w-14 items-center justify-center rounded-full border border-amber/40 text-amber">
                        {step.icon}
                      </span>
                      <span className="font-display text-sm text-amber">Step {i + 1}</span>
                      <h3 className="font-display text-xl text-ink-primary">{step.title}</h3>
                      <p className="font-body leading-relaxed text-ink-secondary">{step.body}</p>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-line-secondary">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-14 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <LogoMark />
              <span className="font-display text-lg text-ink-primary">Somali Music Archive</span>
            </div>
            <p className="max-w-sm font-body text-sm text-ink-tertiary">
              A project of the Somali Music Preservation Foundation. Preserving a living heritage
              for the children of tomorrow.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-12 gap-y-2 font-body text-sm">
            <Link href="/listen" className="text-ink-secondary hover:text-amber">
              Listen
            </Link>
            <Link href="/library" className="text-ink-secondary hover:text-amber">
              Library
            </Link>
            <a href="#research" className="text-ink-secondary hover:text-amber">
              Research
            </a>
            <Link href="/register" className="text-ink-secondary hover:text-amber">
              Register
            </Link>
            <Link href="/login" className="text-ink-secondary hover:text-amber">
              Sign in
            </Link>
          </div>
        </div>
        <div className="border-t border-line-secondary py-6">
          <p className="text-center font-body text-xs text-ink-tertiary">
            © {new Date().getFullYear()} Somali Music Preservation Foundation. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ── Inline icons (no icon dependency; amber via `currentColor`) ──────────── */

function BooksIcon(): React.JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17.5H7.5A2.5 2.5 0 0 0 5 22V4.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M5 19.5A2.5 2.5 0 0 1 7.5 17H19" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 7h6M9 10.5h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ArchiveIcon(): React.JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="4" width="18" height="4" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 12h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function LearnIcon(): React.JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 5 3 9l9 4 9-4-9-4Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M7 11v4c0 1.1 2.24 2 5 2s5-.9 5-2v-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ResearchIcon(): React.JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function UploadIcon(): React.JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 16V6m0 0-4 4m4-4 4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5 19h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SparkIcon(): React.JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v4m0 10v4m9-9h-4M7 12H3m14.5-6.5-2.8 2.8M9.3 14.7l-2.8 2.8m11 0-2.8-2.8M9.3 9.3 6.5 6.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ShareIcon(): React.JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="6" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="18" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="18" cy="18" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="m8.2 10.8 7.6-3.6m0 9.6L8.2 13.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
