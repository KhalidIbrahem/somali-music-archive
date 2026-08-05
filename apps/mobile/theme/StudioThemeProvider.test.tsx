/**
 * B1-01b Expo parity: explicit preference overrides system, toggle records an
 * explicit choice, and consumers get the matching token set.
 */

import { renderHook, act } from '@testing-library/react-native';
import { StudioThemeProvider, useStudioTheme } from './StudioThemeProvider';
import { studioThemes } from './studio';
import { useSettingsStore } from '@/stores/settingsStore';

const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <StudioThemeProvider>{children}</StudioThemeProvider>
);

beforeEach(() => {
  useSettingsStore.setState({ themePreference: 'system' });
});

describe('StudioThemeProvider', () => {
  it('explicit preference overrides system and maps to the right tokens', async () => {
    const { result } = await renderHook(() => useStudioTheme(), { wrapper });

    await act(async () => useSettingsStore.getState().setThemePreference('light'));
    expect(result.current.name).toBe('light');
    expect(result.current.tokens.paper).toBe(studioThemes.light.paper);

    await act(async () => useSettingsStore.getState().setThemePreference('dark'));
    expect(result.current.name).toBe('dark');
    expect(result.current.tokens.paper).toBe(studioThemes.dark.paper);
  });

  it('toggle flips the resolved theme and records an explicit preference', async () => {
    useSettingsStore.setState({ themePreference: 'dark' });
    const { result } = await renderHook(() => useStudioTheme(), { wrapper });

    await act(async () => result.current.toggle());
    expect(useSettingsStore.getState().themePreference).toBe('light');
    expect(result.current.name).toBe('light');
    expect(result.current.tokens.paper).toBe(studioThemes.light.paper);
  });

  it('system preference resolves to a valid theme with matching tokens', async () => {
    const { result } = await renderHook(() => useStudioTheme(), { wrapper });
    expect(result.current.preference).toBe('system');
    expect(['dark', 'light']).toContain(result.current.name);
    expect(result.current.tokens).toBe(studioThemes[result.current.name]);
  });
});
