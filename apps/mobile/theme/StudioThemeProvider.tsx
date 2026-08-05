/**
 * StudioThemeProvider — Expo parity for the web theme system (B1-01b).
 *
 * Resolution order matches the web bootstrap: explicit preference (settings
 * store) → system appearance → dark. The preference lives in the in-memory
 * settings store for now — device persistence rides the store's planned
 * persistence work (P2-07), then the user record in Block 2, mirroring the
 * web's localStorage-until-auth plan.
 *
 * Consumers style from `tokens` (a StudioTheme) — never from hardcoded hex.
 */

import { createContext, useCallback, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { studioThemes, type StudioTheme, type StudioThemeName } from './studio';
import { useSettingsStore, type ThemePreference } from '@/stores/settingsStore';

interface StudioThemeValue {
  /** The resolved theme name after applying preference over system. */
  name: StudioThemeName;
  /** Token values for the resolved theme. */
  tokens: StudioTheme;
  /** The raw preference ('system' until the user chooses explicitly). */
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  /** Flip the resolved theme (records an explicit preference). */
  toggle: () => void;
}

const StudioThemeContext = createContext<StudioThemeValue | null>(null);

export function StudioThemeProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const system = useColorScheme();
  const preference = useSettingsStore((s) => s.themePreference);
  const setPreference = useSettingsStore((s) => s.setThemePreference);

  const name: StudioThemeName =
    preference === 'system' ? (system === 'light' ? 'light' : 'dark') : preference;

  const toggle = useCallback((): void => {
    setPreference(name === 'dark' ? 'light' : 'dark');
  }, [name, setPreference]);

  const value = useMemo<StudioThemeValue>(
    () => ({ name, tokens: studioThemes[name], preference, setPreference, toggle }),
    [name, preference, setPreference, toggle],
  );

  return <StudioThemeContext.Provider value={value}>{children}</StudioThemeContext.Provider>;
}

export function useStudioTheme(): StudioThemeValue {
  const ctx = useContext(StudioThemeContext);
  if (ctx === null) throw new Error('useStudioTheme must be used inside <StudioThemeProvider>');
  return ctx;
}
