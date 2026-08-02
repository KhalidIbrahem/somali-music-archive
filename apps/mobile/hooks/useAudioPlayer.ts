/**
 * useAudioPlayer — streaming playback for archive recordings (SESSION P1-05).
 *
 * Loads audio from a short-lived signed URL (§11 Threat 1) and drives play/pause/
 * seek with live position + duration. One expo-audio player is held per hook
 * instance and released on unload/unmount. The global mini-player state lives in
 * playerStore; this hook owns the actual audio object.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';

export interface UseAudioPlayer {
  isLoading: boolean;
  isPlaying: boolean;
  positionMillis: number;
  durationMillis: number;
  load: (url: string) => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  togglePlay: () => Promise<void>;
  seek: (millis: number) => Promise<void>;
}

export function useAudioPlayer(): UseAudioPlayer {
  const playerRef = useRef<AudioPlayer | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(0);

  const onStatus = useCallback((status: AudioStatus) => {
    if (!status.isLoaded) return;
    setIsPlaying(status.playing);
    setPositionMillis(Math.round(status.currentTime * 1000));
    setDurationMillis(Math.round(status.duration * 1000));
    if (status.didJustFinish) {
      setIsPlaying(false);
      setPositionMillis(0);
      void playerRef.current?.seekTo(0);
    }
  }, []);

  const load = useCallback(
    async (url: string) => {
      setIsLoading(true);
      try {
        playerRef.current?.remove();
        playerRef.current = null;
        await setAudioModeAsync({ playsInSilentMode: true });
        const player = createAudioPlayer({ uri: url }, { updateInterval: 250 });
        player.addListener('playbackStatusUpdate', onStatus);
        playerRef.current = player;
      } finally {
        setIsLoading(false);
      }
    },
    [onStatus],
  );

  const play = useCallback(async () => {
    playerRef.current?.play();
  }, []);

  const pause = useCallback(async () => {
    playerRef.current?.pause();
  }, []);

  const togglePlay = useCallback(async () => {
    if (isPlaying) await pause();
    else await play();
  }, [isPlaying, play, pause]);

  const seek = useCallback(async (millis: number) => {
    await playerRef.current?.seekTo(Math.max(0, millis) / 1000);
  }, []);

  useEffect(() => {
    return () => {
      playerRef.current?.remove();
      playerRef.current = null;
    };
  }, []);

  return {
    isLoading,
    isPlaying,
    positionMillis,
    durationMillis,
    load,
    play,
    pause,
    togglePlay,
    seek,
  };
}
