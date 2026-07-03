/**
 * useAudioRecorder — field recording via expo-av (ARCHITECTURE.md §6, SESSION P1-03).
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
import { Audio } from 'expo-av';

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
 * Normalise expo-av's metering (decibels, roughly -160 dB silence → 0 dB peak) to
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
const WAV_RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: true,
  keepAudioActiveHint: true,
  android: {
    extension: '.wav',
    outputFormat: Audio.AndroidOutputFormat.DEFAULT,
    audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
    sampleRate: 44100,
    numberOfChannels: 2,
    bitRate: 256000,
  },
  ios: {
    extension: '.wav',
    audioQuality: Audio.IOSAudioQuality.MAX,
    outputFormat: Audio.IOSOutputFormat.LINEARPCM,
    sampleRate: 44100,
    numberOfChannels: 2,
    bitRate: 256000,
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
  const recordingRef = useRef<Audio.Recording | null>(null);
  const durationRef = useRef(0);
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [durationMillis, setDurationMillis] = useState(0);
  const [meterLevel, setMeterLevel] = useState(0);
  const [uri, setUri] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const onStatusUpdate = useCallback((s: Audio.RecordingStatus) => {
    if (!s.isRecording) return;
    durationRef.current = s.durationMillis;
    setDurationMillis(s.durationMillis);
    if (typeof s.metering === 'number') {
      setMeterLevel(normalizeMeter(s.metering));
    }
  }, []);

  const start = useCallback(async () => {
    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) {
      setPermissionDenied(true);
      throw new Error('Microphone permission denied');
    }
    setPermissionDenied(false);
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

    const { recording } = await Audio.Recording.createAsync(
      WAV_RECORDING_OPTIONS,
      onStatusUpdate,
      100,
    );
    recordingRef.current = recording;
    durationRef.current = 0;
    setUri(null);
    setDurationMillis(0);
    setMeterLevel(0);
    setStatus('recording');
  }, [onStatusUpdate]);

  const stop = useCallback(async (): Promise<RecorderResult | null> => {
    const recording = recordingRef.current;
    if (!recording) return null;
    try {
      await recording.stopAndUnloadAsync();
    } finally {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    }
    const finalUri = recording.getURI();
    recordingRef.current = null;
    setMeterLevel(0);
    setStatus('stopped');
    if (!finalUri) return null;
    setUri(finalUri);
    return { uri: finalUri, durationMillis: durationRef.current };
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setUri(null);
    setDurationMillis(0);
    setMeterLevel(0);
    durationRef.current = 0;
  }, []);

  // Safety net: if the screen unmounts mid-take, release the recorder.
  useEffect(() => {
    return () => {
      recordingRef.current?.stopAndUnloadAsync().catch(() => undefined);
    };
  }, []);

  return { status, durationMillis, meterLevel, uri, permissionDenied, start, stop, reset };
}
