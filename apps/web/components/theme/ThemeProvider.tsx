'use client';

/**
 * ThemeProvider — owns the html[data-theme] attribute after the bootstrap
 * script (lib/theme.ts) has set its pre-paint value.
 *
 * The switch is CSS-variable-only: toggling rewrites one attribute, every
 * token utility resolves through var(), and nothing below this provider
 * re-renders except consumers of the context value (the toggle button).
 * Persistence: explicit choices only — a first visit that merely followed the
 * system preference stays un-persisted so the OS setting keeps governing.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { THEME_STORAGE_KEY, type ThemeName } from '@/lib/theme';

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (next: ThemeName) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readDomTheme(): ThemeName {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  // Lazy init from the attribute the bootstrap script already set; the SSR
  // pass says 'dark', so theme-dependent UI must gate on mount (ThemeToggle does).
  const [theme, setThemeState] = useState<ThemeName>(readDomTheme);

  const setTheme = useCallback((next: ThemeName): void => {
    setThemeState(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode — the choice still applies for this page's lifetime.
    }
  }, []);

  const toggle = useCallback((): void => {
    setTheme(readDomTheme() === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  // If another tab switches the theme, follow it (same storage key).
  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key === THEME_STORAGE_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        setThemeState(e.newValue);
        document.documentElement.setAttribute('data-theme', e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
