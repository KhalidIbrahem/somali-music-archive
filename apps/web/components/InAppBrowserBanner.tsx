'use client';

/**
 * In-app browser notice (B1-09). Instagram/Facebook/TikTok/Line webviews
 * throttle or break parts of the studio; the honest fix is telling people how
 * to escape to a real browser, not chasing webview quirks (per the addendum:
 * full studio support inside these webviews is a non-goal).
 *
 * Renders nothing on the server and on normal browsers; appears only when the
 * UA identifies an in-app webview and the visitor hasn't dismissed it this
 * session.
 */

import { useState, useSyncExternalStore } from 'react';

const DISMISS_KEY = 'sma.iab.dismissed';
const IN_APP_UA = /\b(Instagram|FBAN|FBAV|FB_IAB|Line\/|TikTok|musical_ly)\b/i;

const emptySubscribe = (): (() => void) => () => undefined;

function detectInApp(): boolean {
  try {
    return IN_APP_UA.test(navigator.userAgent) && sessionStorage.getItem(DISMISS_KEY) !== '1';
  } catch {
    return false;
  }
}

export function InAppBrowserBanner(): React.JSX.Element | null {
  // Hydration-safe mount gate (same pattern as ThemeToggle): SSR and the first
  // client paint agree on "nothing", then detection runs at render time.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const [dismissed, setDismissed] = useState(false);

  if (!mounted || dismissed || !detectInApp()) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 flex items-center gap-3 border-b border-hairline bg-chrome-2 px-4 py-2 text-[13px] text-hi print:hidden"
    >
      <span className="min-w-0 flex-1">
        This site works best in Safari. Tap ··· then Open in browser.
      </span>
      <button
        type="button"
        aria-label="Dismiss this notice"
        onClick={() => {
          try {
            sessionStorage.setItem(DISMISS_KEY, '1');
          } catch {
            // storage blocked — the dismissal still holds for this render
          }
          setDismissed(true);
        }}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-mid transition-colors hover:text-hi focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden
        >
          <line x1="2" y1="2" x2="10" y2="10" />
          <line x1="10" y1="2" x2="2" y2="10" />
        </svg>
      </button>
    </div>
  );
}
