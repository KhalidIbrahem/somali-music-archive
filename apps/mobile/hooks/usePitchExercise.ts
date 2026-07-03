/**
 * usePitchExercise — the interactive "sing the note" loop (ARCHITECTURE.md §7, §10).
 *
 * Records a short attempt with the mic, then reads the WAV, extracts a mono window,
 * runs autocorrelation pitch detection, and scores it against the target note. The
 * analysis pipeline (wav + pitch utils) is pure and unit-tested; this hook wires it
 * to the recorder and the file system.
 */

import { useCallback, useState } from 'react';
import * as FileSystem from 'expo-file-system';
import { useAudioRecorder } from './useAudioRecorder';
import { base64ToBytes, parseWavPcm16, monoFloatWindow } from '@/utils/wav';
import { detectPitch, pitchAccuracy, type PitchAccuracy } from '@/utils/pitch';

export interface PitchAttempt {
  detectedHz: number;
  accuracy: PitchAccuracy;
}

export interface UsePitchExercise {
  isListening: boolean;
  /** Live mic level 0–1 while recording. */
  level: number;
  analyzing: boolean;
  attempt: PitchAttempt | null;
  error: string | null;
  start: () => Promise<void>;
  stopAndScore: () => Promise<void>;
  reset: () => void;
}

export function usePitchExercise(targetHz: number): UsePitchExercise {
  const recorder = useAudioRecorder();
  const [analyzing, setAnalyzing] = useState(false);
  const [attempt, setAttempt] = useState<PitchAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setError(null);
    setAttempt(null);
    try {
      await recorder.start();
    } catch {
      setError('Microphone access is needed. Enable it in Settings.');
    }
  }, [recorder]);

  const stopAndScore = useCallback(async () => {
    const result = await recorder.stop();
    if (!result) return;
    setAnalyzing(true);
    try {
      const base64 = await FileSystem.readAsStringAsync(result.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const pcm = parseWavPcm16(base64ToBytes(base64));
      if (!pcm) {
        setError('Could not read the recording. Try again.');
        return;
      }
      const hz = detectPitch(monoFloatWindow(pcm, 4096), pcm.sampleRate);
      if (hz === null) {
        setError('We could not hear a clear note. Sing a little louder and steadier.');
        return;
      }
      setAttempt({ detectedHz: hz, accuracy: pitchAccuracy(hz, targetHz) });
    } catch {
      setError('Analysis failed. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  }, [recorder, targetHz]);

  const reset = useCallback(() => {
    setAttempt(null);
    setError(null);
    recorder.reset();
  }, [recorder]);

  return {
    isListening: recorder.status === 'recording',
    level: recorder.meterLevel,
    analyzing,
    attempt,
    error,
    start,
    stopAndScore,
    reset,
  };
}
