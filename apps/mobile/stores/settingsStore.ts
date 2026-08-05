/**
 * Settings store (Zustand) — device playback/notification preferences
 * (ARCHITECTURE.md §6, §7 Profile settings).
 *
 * These are non-sensitive device preferences (distinct from the server-synced
 * `user.language`). In-memory for now; persistence lands with offline support
 * (P2-07). Never store tokens here — those live in expo-secure-store.
 */

import { create } from 'zustand';
import type { StudioThemeName } from '@sma/constants';

export type PlaybackQuality = 'standard' | 'high';

/** 'system' follows the OS appearance; an explicit name overrides it (B1-01b). */
export type ThemePreference = StudioThemeName | 'system';

interface SettingsState {
  playbackQuality: PlaybackQuality;
  offlineDownloads: boolean;
  notifications: boolean;
  themePreference: ThemePreference;
  setPlaybackQuality: (quality: PlaybackQuality) => void;
  setOfflineDownloads: (enabled: boolean) => void;
  setNotifications: (enabled: boolean) => void;
  setThemePreference: (preference: ThemePreference) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  playbackQuality: 'high',
  offlineDownloads: false,
  notifications: true,
  themePreference: 'system',
  setPlaybackQuality: (playbackQuality) => set({ playbackQuality }),
  setOfflineDownloads: (offlineDownloads) => set({ offlineDownloads }),
  setNotifications: (notifications) => set({ notifications }),
  setThemePreference: (themePreference) => set({ themePreference }),
}));
