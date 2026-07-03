/**
 * Settings store (Zustand) — device playback/notification preferences
 * (ARCHITECTURE.md §6, §7 Profile settings).
 *
 * These are non-sensitive device preferences (distinct from the server-synced
 * `user.language`). In-memory for now; persistence lands with offline support
 * (P2-07). Never store tokens here — those live in expo-secure-store.
 */

import { create } from 'zustand';

export type PlaybackQuality = 'standard' | 'high';

interface SettingsState {
  playbackQuality: PlaybackQuality;
  offlineDownloads: boolean;
  notifications: boolean;
  setPlaybackQuality: (quality: PlaybackQuality) => void;
  setOfflineDownloads: (enabled: boolean) => void;
  setNotifications: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  playbackQuality: 'high',
  offlineDownloads: false,
  notifications: true,
  setPlaybackQuality: (playbackQuality) => set({ playbackQuality }),
  setOfflineDownloads: (offlineDownloads) => set({ offlineDownloads }),
  setNotifications: (notifications) => set({ notifications }),
}));
