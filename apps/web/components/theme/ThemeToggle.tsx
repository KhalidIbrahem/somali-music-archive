'use client';

/**
 * Theme toggle — lives in the top bar, right side, next to account (§1).
 * 32px studio control. The icon renders only after mount: the SSR pass cannot
 * know the bootstrapped theme, and a fixed-size empty button avoids both a
 * hydration mismatch and layout shift.
 */

import { useSyncExternalStore } from 'react';
import { useTheme } from './ThemeProvider';

const emptySubscribe = (): (() => void) => () => {};

export function ThemeToggle(): React.JSX.Element {
  const { theme, toggle } = useTheme();
  // true after hydration, false in the server snapshot — no effect, no reflow.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={mounted ? label : 'Switch theme'}
      className="flex h-8 w-8 items-center justify-center rounded-[4px] border border-hairline bg-chrome-2 text-mid transition-colors hover:text-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-live"
    >
      {mounted &&
        (theme === 'dark' ? (
          // sun — offered action: switch to light
          <svg
            width="14"
            height="14"
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
          // moon — offered action: switch to dark
          <svg
            width="14"
            height="14"
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
        ))}
    </button>
  );
}
