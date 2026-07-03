/**
 * useAudioPlayer — streaming playback for archive recordings (SESSION P1-05).
 *
 * Loads audio from a short-lived signed URL (§11 Threat 1) and drives play/pause/
 * seek with live position + duration. One expo-av Sound is held per hook instance
 * and released on unload/unmount. The global mini-player state lives in playerStore;
 * this hook owns the actual audio object.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Audio, type AVPlaybackStatus } from 'expo-av';

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
  const soundRef = useRef<Audio.Sound | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(0);

  const onStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    setIsPlaying(status.isPlaying);
    setPositionMillis(status.positionMillis);
    setDurationMillis(status.durationMillis ?? 0);
    if (status.didJustFinish) {
      setIsPlaying(false);
      setPositionMillis(0);
      void soundRef.current?.setPositionAsync(0);
    }
  }, []);

  const load = useCallback(
    async (url: string) => {
      setIsLoading(true);
      try {
        await soundRef.current?.unloadAsync();
        soundRef.current = null;
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const { sound } = await Audio.Sound.createAsync(
          { uri: url },
          { progressUpdateIntervalMillis: 250 },
          onStatus,
        );
        soundRef.current = sound;
      } finally {
        setIsLoading(false);
      }
    },
    [onStatus],
  );

  const play = useCallback(async () => {
    await soundRef.current?.playAsync();
  }, []);

  const pause = useCallback(async () => {
    await soundRef.current?.pauseAsync();
  }, []);

  const togglePlay = useCallback(async () => {
    if (isPlaying) await pause();
    else await play();
  }, [isPlaying, play, pause]);

  const seek = useCallback(async (millis: number) => {
    await soundRef.current?.setPositionAsync(Math.max(0, millis));
  }, []);

  useEffect(() => {
    return () => {
      void soundRef.current?.unloadAsync();
      soundRef.current = null;
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
