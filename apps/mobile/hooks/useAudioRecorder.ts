/**
 * useAudioRecorder — field recording via expo-audio (ARCHITECTURE.md §6, SESSION P1-03).
 *
 * Captures WAV at the highest quality the platform offers (true LINEAR PCM on iOS,
 * best-effort on Android), exposes a live metering level for the waveform, and a
 * running duration. Microphone permission is requested on `start`; denial is
 * surfaced via `permissionDenied` (and thrown) so the screen can guide the user.
 *
 * The recorded file stays local (a `file://` URI); uploading it directly to R2 is
 * the caller's job (services/api/recordings), never through our own API.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder as useExpoAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';

/** Warn the recordist once a take runs long (SESSION P1-03). */
export const LONG_RECORDING_WARNING_MS = 15 * 60 * 1000;
/** Hard ceiling — recordings over an hour are rejected downstream (ARCHITECTURE.md §10). */
export const MAX_RECORDING_MS = 60 * 60 * 1000;

export type RecorderStatus = 'idle' | 'recording' | 'stopped';

export interface RecorderResult {
  uri: string;
  durationMillis: number;
}

/**
 * Normalise expo-audio's metering (decibels, roughly -160 dB silence → 0 dB peak) to
 * a 0–1 level for the waveform. We map the useful vocal/instrument band
 * (-60 dB → 0 dB) onto 0 → 1. Pure and exported so it is unit-tested.
 */
export function normalizeMeter(db: number): number {
  if (!Number.isFinite(db)) return 0;
  const FLOOR_DB = -60;
  const level = (db - FLOOR_DB) / -FLOOR_DB;
  return Math.max(0, Math.min(1, level));
}

/** WAV recording options — LINEAR PCM on iOS is a true .wav; Android best-effort. */
const WAV_RECORDING_OPTIONS: RecordingOptions = {
  isMeteringEnabled: true,
  extension: '.wav',
  sampleRate: 44100,
  numberOfChannels: 2,
  bitRate: 256000,
  android: {
    extension: '.wav',
    outputFormat: 'default',
    audioEncoder: 'default',
  },
  ios: {
    extension: '.wav',
    audioQuality: AudioQuality.MAX,
    outputFormat: IOSOutputFormat.LINEARPCM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 256000,
  },
};

export interface UseAudioRecorder {
  status: RecorderStatus;
  durationMillis: number;
  /** Live input level 0–1, for the waveform. */
  meterLevel: number;
  uri: string | null;
  permissionDenied: boolean;
  start: () => Promise<void>;
  stop: () => Promise<RecorderResult | null>;
  reset: () => void;
}

export function useAudioRecorder(): UseAudioRecorder {
  // expo-audio owns the native recorder's lifecycle (released on unmount).
  const recorder = useExpoAudioRecorder(WAV_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 100);
  const activeRef = useRef(false);
  const durationRef = useRef(0);
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [durationMillis, setDurationMillis] = useState(0);
  const [meterLevel, setMeterLevel] = useState(0);
  const [uri, setUri] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    if (!recorderState.isRecording) return;
    durationRef.current = recorderState.durationMillis;
    setDurationMillis(recorderState.durationMillis);
    if (typeof recorderState.metering === 'number') {
      setMeterLevel(normalizeMeter(recorderState.metering));
    }
  }, [recorderState]);

  const start = useCallback(async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setPermissionDenied(true);
      throw new Error('Microphone permission denied');
    }
    setPermissionDenied(false);
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

    await recorder.prepareToRecordAsync();
    recorder.record();
    activeRef.current = true;
    durationRef.current = 0;
    setUri(null);
    setDurationMillis(0);
    setMeterLevel(0);
    setStatus('recording');
  }, [recorder]);

  const stop = useCallback(async (): Promise<RecorderResult | null> => {
    if (!activeRef.current) return null;
    activeRef.current = false;
    try {
      await recorder.stop();
    } finally {
      await setAudioModeAsync({ allowsRecording: false });
    }
    const finalUri = recorder.uri;
    setMeterLevel(0);
    setStatus('stopped');
    if (!finalUri) return null;
    setUri(finalUri);
    return { uri: finalUri, durationMillis: durationRef.current };
  }, [recorder]);

  const reset = useCallback(() => {
    setStatus('idle');
    setUri(null);
    setDurationMillis(0);
    setMeterLevel(0);
    durationRef.current = 0;
  }, []);

  return { status, durationMillis, meterLevel, uri, permissionDenied, start, stop, reset };
}
