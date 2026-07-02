/**
 * Global audio player state (Zustand) — in-memory only (ARCHITECTURE.md §6).
 *
 * This drives the persistent mini-player that rises from the bottom of the app
 * while a recording plays. It holds only *which* recording is loaded and transport
 * state; the actual `expo-av` Sound object is owned by the audio service layer.
 */

import { create } from 'zustand';
import type { PublicRecording } from '@sma/types';

interface PlayerState {
  current: PublicRecording | null;
  isPlaying: boolean;
  /** Playback position in milliseconds. */
  positionMs: number;
  /** Total duration in milliseconds, once known. */
  durationMs: number;
  load: (recording: PublicRecording) => void;
  setPlaying: (isPlaying: boolean) => void;
  setProgress: (positionMs: number, durationMs: number) => void;
  clear: () => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  current: null,
  isPlaying: false,
  positionMs: 0,
  durationMs: 0,
  load: (recording) => set({ current: recording, positionMs: 0, isPlaying: true }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setProgress: (positionMs, durationMs) => set({ positionMs, durationMs }),
  clear: () => set({ current: null, isPlaying: false, positionMs: 0, durationMs: 0 }),
}));
