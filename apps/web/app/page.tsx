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

const NAV = [
  { label: 'Home', href: '/' },
  { label: 'Archive', href: '#preserve' },
  { label: 'Learn', href: '#learn' },
  { label: 'Research', href: '#research' },
];

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
      {/* ── Navigation ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-line-secondary bg-bg-primary/85 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <LogoMark />
            <span className="font-display text-lg tracking-wide text-ink-primary">
              Somali Music Archive
            </span>
          </Link>
          <div className="hidden items-center gap-8 md:flex">
            {NAV.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="font-body text-sm text-ink-secondary transition-colors hover:text-amber"
              >
                {item.label}
              </a>
            ))}
          </div>
          <Link
            href="/login"
            className="rounded-lg border border-amber/40 px-4 py-2 font-body text-sm font-semibold text-amber transition-colors hover:bg-amber hover:text-bg-primary"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <main>
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-amber/10 blur-3xl"
          />
          <div className="mx-auto flex max-w-4xl flex-col items-center gap-8 px-6 py-28 text-center">
            <p className="font-body text-sm uppercase tracking-[0.25em] text-amber">
              AI-powered cultural preservation
            </p>
            <h1 className="font-display text-6xl leading-[1.05] text-ink-primary sm:text-7xl">
              Somali Music Archive
            </h1>
            <p className="max-w-2xl font-body text-xl leading-relaxed text-ink-secondary">
              <span className="text-ink-primary">
                Muusigga hidaha Soomaalida — la keydiyay, la baray, la wadaagay.
              </span>
              <br />
              The music of our ancestors, preserved forever and opened to the world.
            </p>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <a
                href="#preserve"
                className="rounded-xl bg-amber px-7 py-3 font-body font-semibold text-bg-primary transition-transform hover:-translate-y-0.5"
              >
                Explore the archive
              </a>
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
            {STATS.map((stat) => (
              <div key={stat.label} className="flex flex-col items-center gap-1 py-8">
                <span className="font-display text-5xl text-amber">{stat.value}</span>
                <span className="font-body text-sm uppercase tracking-wider text-ink-secondary">
                  {stat.label}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Feature cards ────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-6 py-24">
          <div className="grid gap-6 md:grid-cols-3">
            {FEATURES.map((feature) => (
              <article
                key={feature.id}
                id={feature.id}
                className="flex scroll-mt-24 flex-col gap-4 rounded-2xl border border-line-secondary bg-bg-secondary p-8 transition-colors hover:border-amber/40"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber/10 text-amber">
                  {feature.icon}
                </span>
                <h3 className="font-display text-2xl text-ink-primary">{feature.title}</h3>
                <p className="font-body leading-relaxed text-ink-secondary">{feature.body}</p>
              </article>
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
                <li key={step.title} className="flex flex-col items-center gap-4 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full border border-amber/40 text-amber">
                    {step.icon}
                  </span>
                  <span className="font-display text-sm text-amber">Step {i + 1}</span>
                  <h3 className="font-display text-xl text-ink-primary">{step.title}</h3>
                  <p className="font-body leading-relaxed text-ink-secondary">{step.body}</p>
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
            <a href="#preserve" className="text-ink-secondary hover:text-amber">
              Archive
            </a>
            <a href="#learn" className="text-ink-secondary hover:text-amber">
              Learn
            </a>
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

function LogoMark(): React.JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="#C89B5F" strokeWidth="1.5" />
      <path
        d="M9 8l7-2v8.5"
        stroke="#C89B5F"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7.5" cy="14.5" r="2" stroke="#C89B5F" strokeWidth="1.5" />
      <circle cx="14.5" cy="12.5" r="2" stroke="#C89B5F" strokeWidth="1.5" />
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
