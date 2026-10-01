/**
 * Optional engine features the editing UI uses when the engine provides them
 * (Studio v2): audio-file peaks for waveforms, audio loading, and audio
 * recording. The engine is developed separately; this adapter lets the UI
 * compile and degrade gracefully before those methods exist, without casts —
 * `DawEngine` is structurally assignable to `EngineExtras` because every
 * extra is optional, and every return value is validated at runtime.
 */

import type { DawEngine } from './engine';

export interface EngineExtras {
  /** Always present — anchors the structural assignment. */
  audition: DawEngine['audition'];
  /** Peaks over the WHOLE file: `buckets` abs peaks, or 2×buckets interleaved min/max. */
  getPeaks?: (source: string, buckets: number) => unknown;
  /** Decode/cache a source; may resolve to an AudioBuffer (its duration is used). */
  loadAudio?: (source: string) => unknown;
  startRecording?: (trackId: string) => unknown;
  /** Resolves to the recorded DawAudioRegion (validated with isAudioRegion). */
  stopRecording?: () => unknown;
}

export function engineExtras(engine: DawEngine): EngineExtras {
  return engine;
}

export interface Peaks {
  /** Per bucket, 0–1 lower (≤0) and upper (≥0) extents. */
  min: Float32Array;
  max: Float32Array;
}

/** Normalise whatever getPeaks returned into min/max arrays, or null. */
export function toPeaks(value: unknown, buckets: number): Peaks | null {
  let data: ArrayLike<number> | null = null;
  if (value instanceof Float32Array) data = value;
  else if (Array.isArray(value) && value.every((v) => typeof v === 'number')) data = value;
  if (data === null || data.length === 0) return null;
  const interleaved = data.length === buckets * 2;
  const count = interleaved ? buckets : data.length;
  const min = new Float32Array(count);
  const max = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    if (interleaved) {
      min[i] = Math.min(0, data[i * 2] ?? 0);
      max[i] = Math.max(0, data[i * 2 + 1] ?? 0);
    } else {
      const p = Math.abs(data[i] ?? 0);
      min[i] = -p;
      max[i] = p;
    }
  }
  return { min, max };
}

/** Duration in seconds from a loadAudio result (AudioBuffer-like), else null. */
export function durationOf(value: unknown): number | null {
  if (typeof value !== 'object' || value === null || !('duration' in value)) return null;
  const duration = value.duration;
  return typeof duration === 'number' && duration > 0 ? duration : null;
}

/** Await a value that may or may not be a promise. */
export async function settle(value: unknown): Promise<unknown> {
  return await Promise.resolve(value);
}
