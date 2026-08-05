/**
 * Theme plumbing shared by server and client (B1-01b).
 *
 * Dark is the default. First visit respects prefers-color-scheme; an explicit
 * choice persists in localStorage (moves to the user record in Block 2). The
 * bootstrap script below is inlined at the very top of <body> so the attribute
 * lands on <html> before first paint — no flash of the wrong theme, and the
 * theme switch itself is pure CSS-variable work (no React re-render of the
 * score canvas).
 */

import type { StudioThemeName } from '@sma/constants';

export type ThemeName = StudioThemeName;

export const THEME_STORAGE_KEY = 'sma.theme';

/**
 * Runs before first paint. Explicit stored choice wins; otherwise the system
 * preference; otherwise dark. Any storage failure (private mode) falls back to
 * dark rather than throwing before the app exists.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function () {
  try {
    var stored = window.localStorage.getItem('${THEME_STORAGE_KEY}');
    var theme =
      stored === 'light' || stored === 'dark'
        ? stored
        : window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();`;
