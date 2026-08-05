'use client';

/**
 * Studio top bar (56px): rail toggles + wordmark + session title + save state
 * on the left; export, theme toggle, account on the right (§1: the toggle
 * lives here, next to account — never buried in settings).
 */

import Link from 'next/link';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

function RailToggle({
  side,
  open,
  onToggle,
}: {
  side: 'library' | 'inspector';
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const label = open
    ? side === 'library'
      ? 'Hide the library'
      : 'Hide the inspector'
    : side === 'library'
      ? 'Show the library'
      : 'Show the inspector';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-pressed={open}
      title={label}
      className={`flex h-8 w-8 items-center justify-center rounded-[4px] border border-hairline transition-colors hover:text-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-live ${
        open ? 'bg-chrome-2 text-hi' : 'bg-transparent text-low'
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="1.5" y="2.5" width="13" height="11" rx="1" stroke="currentColor" />
        {side === 'library' ? (
          <line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" />
        ) : (
          <line x1="10" y1="2.5" x2="10" y2="13.5" stroke="currentColor" />
        )}
      </svg>
    </button>
  );
}

export function StudioTopBar({
  libraryOpen,
  inspectorOpen,
  onToggleLibrary,
  onToggleInspector,
}: {
  libraryOpen: boolean;
  inspectorOpen: boolean;
  onToggleLibrary: () => void;
  onToggleInspector: () => void;
}): React.JSX.Element {
  return (
    <header className="flex h-(--studio-top-bar) shrink-0 items-center gap-2 border-b border-hairline bg-chrome-1 px-2 print:hidden">
      <RailToggle side="library" open={libraryOpen} onToggle={onToggleLibrary} />

      <Link
        href="/"
        className="ml-2 rounded-[4px] font-display text-sm tracking-wide text-mid transition-colors hover:text-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-live"
      >
        Somali Music Archive
      </Link>
      <span aria-hidden className="h-4 w-px bg-hairline" />
      <h1 className="truncate text-sm font-semibold text-hi">Sample session — voice</h1>
      <span className="hidden items-center gap-2 text-xs text-low sm:flex">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent-state" />
        All changes saved
      </span>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          className="flex h-8 items-center rounded-[4px] border border-hairline bg-chrome-2 px-4 text-sm text-hi transition-colors hover:border-accent-state focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-live"
        >
          Export
        </button>
        <span aria-hidden className="h-4 w-px bg-hairline" />
        <ThemeToggle />
        <button
          type="button"
          aria-label="Account"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-hairline bg-chrome-2 text-mid transition-colors hover:text-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-live"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" strokeLinecap="round" />
          </svg>
        </button>
        <RailToggle side="inspector" open={inspectorOpen} onToggle={onToggleInspector} />
      </div>
    </header>
  );
}
