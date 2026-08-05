'use client';

/**
 * QaraamiHome — the site's face (/): a dedicated music-AI product landing in
 * the QaraamiGen visual system (deep navy + teal, dual dark/light themes with
 * a persistent toggle). One coherent story: transcription + generation +
 * the living archive. Inner tool pages keep their own flows; this shell owns
 * first impressions.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

type StudioTheme = 'dark' | 'light';
const THEME_KEY = 'qg.theme';

const NAV = [
  { label: 'Transcribe', href: '/studio/transcribe' },
  { label: 'Generate', href: '/generate' },
  { label: 'Listen', href: '/listen' },
  { label: 'Library', href: '/library' },
] as const;

const STATS = [
  { value: '10 ms', label: 'vocal pitch resolution' },
  { value: '2 staves', label: 'voice + kaban scores' },
  { value: '±cents', label: 'microtones preserved' },
  { value: '5', label: 'instruments to choose' },
] as const;

const TOOLS = [
  {
    title: 'Transcribe',
    so: 'Qoraalka',
    href: '/studio/transcribe',
    body: 'Audio in, engraved sheet music out — pick voice, kaban, violin, or flute. Beat-tracked through rubato; ornaments marked, never erased.',
    cta: 'Open the transcriber',
  },
  {
    title: 'Generate',
    so: 'Abuur',
    href: '/generate',
    body: 'Describe a song and let the QaraamiGen models compose in the spirit of the tradition — experiments, kept apart from the archive.',
    cta: 'Open the generator',
  },
  {
    title: 'The Archive',
    so: 'Kaydka',
    href: '/listen',
    body: 'Restored recordings from digitised cassettes and the scanned music-sheet library — the living corpus this research grows from.',
    cta: 'Enter the listening room',
  },
] as const;

const INSTRUMENTS = [
  'Codka · Voice',
  'Kaban · Oud',
  'Fiyooliin · Violin',
  'Biibiile · Flute',
] as const;

function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: StudioTheme;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--qg-line)] text-[var(--qg-ink2)] transition-colors hover:border-[var(--qg-accent)] hover:text-[var(--qg-accent)]"
    >
      {theme === 'dark' ? (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
        </svg>
      ) : (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  );
}

export function QaraamiHome(): React.JSX.Element {
  const [theme, setTheme] = useState<StudioTheme>('dark');

  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') setTheme(saved);
  }, []);

  const toggle = (): void => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem(THEME_KEY, next);
      return next;
    });
  };

  return (
    <div className="qg min-h-screen font-body transition-colors" data-theme={theme}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-[var(--qg-line)] bg-[var(--qg-bg)]/85 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
              <path
                d="M3 13h2.2M7.6 8v10M12 4.5v17M16.4 8v10"
                stroke="var(--qg-accent)"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <circle cx="20.8" cy="17.6" r="2.6" stroke="var(--qg-amber)" strokeWidth="1.8" />
              <path
                d="M23.4 17.6V6.8l-2 .8"
                stroke="var(--qg-amber)"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            <span className="font-display text-lg tracking-wide text-[var(--qg-ink)]">
              Somali Music <span className="text-[var(--qg-accent)]">AI</span>
            </span>
          </Link>
          <div className="hidden items-center gap-7 md:flex">
            {NAV.map((n) => (
              <Link
                key={n.label}
                href={n.href}
                className="font-body text-sm text-[var(--qg-ink2)] transition-colors hover:text-[var(--qg-accent)]"
              >
                {n.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle theme={theme} onToggle={toggle} />
            <Link
              href="/login"
              className="rounded-lg border border-[var(--qg-accent)]/50 px-4 py-2 font-body text-sm font-semibold text-[var(--qg-accent)] transition-colors hover:bg-[var(--qg-accent)] hover:text-[var(--qg-bg)]"
            >
              Sign in
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden border-b border-[var(--qg-line)]">
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <svg
              className="qg-float-slow absolute -right-8 top-10 opacity-25"
              width="360"
              height="360"
              viewBox="0 0 100 100"
              fill="none"
            >
              <path
                d="M14 76c24 8 44-4 48-22s20-28 34-26"
                stroke="var(--qg-accent)"
                strokeWidth="0.8"
                strokeLinecap="round"
              />
              <circle cx="30" cy="68" r="4" fill="var(--qg-accent)" />
              <path
                d="M34 68V44l10 4"
                stroke="var(--qg-accent)"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <circle cx="64" cy="50" r="3.4" fill="var(--qg-amber)" />
              <path
                d="M67.4 50V30"
                stroke="var(--qg-amber)"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
            <svg
              className="qg-float absolute -left-6 bottom-4 opacity-20"
              width="240"
              height="240"
              viewBox="0 0 100 100"
              fill="none"
            >
              <path
                d="M8 32c20-12 42-6 54 8s24 16 32 12"
                stroke="var(--qg-accent)"
                strokeWidth="0.8"
                strokeLinecap="round"
              />
              <circle cx="44" cy="62" r="4" fill="var(--qg-accent)" />
              <path
                d="M48 62V40h12v18"
                stroke="var(--qg-accent)"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <circle cx="64" cy="58" r="4" fill="var(--qg-accent)" />
            </svg>
          </div>
          <div className="relative mx-auto max-w-6xl px-6 py-24 text-center lg:py-28">
            <p className="font-body text-sm uppercase tracking-[0.3em] text-[var(--qg-accent)]">
              Dhaxalka · heritage, heard by machines
            </p>
            <h1 className="mx-auto mt-4 max-w-4xl font-display text-5xl leading-tight text-[var(--qg-ink)] sm:text-6xl lg:text-7xl">
              Music AI built for the
              <span className="block text-[var(--qg-accent)]">Somali tradition</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl font-body text-lg leading-relaxed text-[var(--qg-ink2)]">
              Transcribe recordings into professional sheet music. Generate new pieces in the spirit
              of qaraami. Preserve the archive they both learn from — with microtones{' '}
              <span className="text-[var(--qg-amber)]">kept and marked</span>, never corrected away.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/studio/transcribe"
                className="rounded-xl bg-[var(--qg-accent)] px-8 py-4 font-body text-base font-bold text-[var(--qg-bg)] transition-transform hover:-translate-y-0.5"
              >
                Transcribe a recording
              </Link>
              <Link
                href="/generate"
                className="rounded-xl border border-[var(--qg-line)] px-8 py-4 font-body text-base text-[var(--qg-ink2)] transition-colors hover:border-[var(--qg-accent)] hover:text-[var(--qg-accent)]"
              >
                Generate music
              </Link>
            </div>
            <p className="mt-8 font-body text-xs uppercase tracking-wider text-[var(--qg-ink3)]">
              {INSTRUMENTS.join('   ·   ')}
            </p>
          </div>
          <div className="relative border-t border-[var(--qg-line)] bg-[var(--qg-bg2)]">
            <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-6 py-8 sm:grid-cols-4">
              {STATS.map((s) => (
                <div key={s.label} className="text-center">
                  <p className="font-display text-2xl text-[var(--qg-accent)]">{s.value}</p>
                  <p className="mt-1 font-body text-xs text-[var(--qg-ink2)]">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Three rooms ──────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-6 md:grid-cols-3">
            {TOOLS.map((t) => (
              <Link
                key={t.title}
                href={t.href}
                className="group rounded-2xl border border-[var(--qg-line)] bg-[var(--qg-panel)] p-7 transition-colors hover:border-[var(--qg-accent)]/60"
              >
                <p className="font-body text-xs uppercase tracking-[0.25em] text-[var(--qg-accent)]">
                  {t.so}
                </p>
                <h2 className="mt-2 font-display text-2xl text-[var(--qg-ink)]">{t.title}</h2>
                <p className="mt-3 font-body text-sm leading-relaxed text-[var(--qg-ink2)]">
                  {t.body}
                </p>
                <p className="mt-5 font-body text-sm font-semibold text-[var(--qg-accent)] transition-transform group-hover:translate-x-1">
                  {t.cta} →
                </p>
              </Link>
            ))}
          </div>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="border-t border-[var(--qg-line)] py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-6 text-center">
          <p className="font-body text-sm text-[var(--qg-ink2)]">
            Somali Music AI — preservation, transcription, and generation research.
          </p>
          <p className="font-body text-xs text-[var(--qg-ink3)]">
            Built on the restored archive · AI experiments stay clearly separate from the historical
            recordings
          </p>
        </div>
      </footer>
    </div>
  );
}
