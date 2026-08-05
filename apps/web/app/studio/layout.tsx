'use client';

/**
 * QaraamiGen Studio shell — a dedicated product surface with its own identity
 * (deep navy + teal, dual themes), deliberately independent of the archive's
 * amber site chrome. Everything under /studio renders inside the `.qg` scope
 * whose CSS variables (globals.css) flip via data-theme; the choice persists
 * in localStorage. The archive pages are untouched.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

type StudioTheme = 'dark' | 'light';
const THEME_KEY = 'qg.theme';

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
        // sun
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
        // moon
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

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
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
      <header className="sticky top-0 z-20 border-b border-[var(--qg-line)] bg-[var(--qg-bg)]/85 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/studio" className="flex items-center gap-2.5">
            {/* waveform-to-note mark */}
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
              QaraamiGen <span className="text-[var(--qg-accent)]">Studio</span>
            </span>
          </Link>
          <div className="flex items-center gap-6">
            <Link
              href="/studio"
              className="hidden font-body text-sm text-[var(--qg-ink2)] transition-colors hover:text-[var(--qg-accent)] sm:block"
            >
              Home
            </Link>
            <Link
              href="/studio/transcribe"
              className="hidden font-body text-sm text-[var(--qg-ink2)] transition-colors hover:text-[var(--qg-accent)] sm:block"
            >
              Transcribe
            </Link>
            <a
              href="/"
              className="hidden font-body text-sm text-[var(--qg-ink3)] transition-colors hover:text-[var(--qg-amber)] sm:block"
            >
              Archive ↗
            </a>
            <ThemeToggle theme={theme} onToggle={toggle} />
            <Link
              href="/studio/transcribe"
              className="rounded-lg bg-[var(--qg-accent)] px-4 py-2 font-body text-sm font-bold text-[var(--qg-bg)] transition-transform hover:-translate-y-0.5"
            >
              Try it now
            </Link>
          </div>
        </nav>
      </header>

      {children}

      <footer className="border-t border-[var(--qg-line)] py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-6 text-center">
          <p className="font-body text-sm text-[var(--qg-ink2)]">
            QaraamiGen Studio — AI music transcription built for the Somali tradition.
          </p>
          <p className="font-body text-xs text-[var(--qg-ink3)]">
            Part of the{' '}
            <a href="/" className="text-[var(--qg-amber)] hover:underline">
              Somali Music Archive
            </a>{' '}
            research platform · microtones preserved, never corrected
          </p>
        </div>
      </footer>
    </div>
  );
}
