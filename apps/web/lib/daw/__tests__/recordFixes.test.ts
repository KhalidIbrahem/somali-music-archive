import { describe, expect, it } from 'vitest';
import {
  RECORD_OFFSET_MAX_MS,
  RECORD_OFFSET_MIN_MS,
  clampRecordOffsetMs,
  roundTripDelaySec,
} from '../audioSchedule';
import { GROOVE_MIN_BARS, grooveFillBars } from '../grooves';
import { audioBufferToMp3, floatToInt16, sharePeakGain } from '../mp3';
import {
  HEADPHONES_HINT_KEY,
  RECORD_OFFSET_KEY,
  readRecordOffsetMs,
  saveRecordOffsetMs,
  takeHeadphonesHint,
} from '../recordFlow';
import { setRecordingAudioSession } from '../../audio/silentMode';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

/** A capture starting at `captureStart` in which each click arrives `delay` s late. */
function captureWithClicks(
  clickTimes: number[],
  delay: number,
  opts: { sampleRate?: number; captureStart?: number; noise?: number; level?: number } = {},
): { samples: Float32Array; sampleRate: number; captureStart: number } {
  const sampleRate = opts.sampleRate ?? 48000;
  const captureStart = opts.captureStart ?? 10;
  const last = clickTimes[clickTimes.length - 1] ?? captureStart;
  const samples = new Float32Array(Math.round((last + 0.5 - captureStart) * sampleRate));
  let seed = 7;
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    samples[i] = ((seed / 0x7fffffff) * 2 - 1) * (opts.noise ?? 0.0005);
  }
  for (const t of clickTimes) {
    const at = Math.round((t + delay - captureStart) * sampleRate);
    for (let i = 0; i < 0.04 * sampleRate && at + i < samples.length; i++) {
      samples[at + i] =
        (opts.level ?? 0.3) * Math.exp(-i / (0.01 * sampleRate)) * (i % 46 < 23 ? 1 : -1);
    }
  }
  return { samples, sampleRate, captureStart };
}

describe('roundTripDelaySec', () => {
  const clicks = [10.35, 10.75, 11.15, 11.55, 11.95];

  it('finds the delay between scheduled clicks and their arrival', () => {
    for (const delay of [0.012, 0.085, 0.21]) {
      const c = captureWithClicks(clicks, delay);
      const got = roundTripDelaySec(c.samples, c.sampleRate, c.captureStart, clicks);
      expect(got).not.toBeNull();
      expect(Math.abs((got ?? 0) - delay)).toBeLessThan(0.001);
    }
  });

  it('works at 44.1 kHz and with a quiet click over room noise', () => {
    const c = captureWithClicks(clicks, 0.14, { sampleRate: 44100, level: 0.03, noise: 0.002 });
    const got = roundTripDelaySec(c.samples, c.sampleRate, c.captureStart, clicks);
    expect(Math.abs((got ?? 0) - 0.14)).toBeLessThan(0.002);
  });

  it('is null when the clicks were not heard (headphones)', () => {
    const c = captureWithClicks([], 0, { captureStart: 10 });
    const silent = new Float32Array(48000 * 3).map((_, i) => c.samples[i % c.samples.length] ?? 0);
    expect(roundTripDelaySec(silent, 48000, 10, clicks)).toBeNull();
  });

  it('is null when fewer than three clicks arrive', () => {
    const c = captureWithClicks(clicks.slice(0, 2), 0.05);
    const padded = new Float32Array(48000 * 3);
    padded.set(c.samples.subarray(0, Math.min(c.samples.length, padded.length)));
    expect(roundTripDelaySec(padded, 48000, 10, clicks)).toBeNull();
  });

  it('is null with no clicks or a bad sample rate', () => {
    expect(roundTripDelaySec(new Float32Array(10), 48000, 0, [])).toBeNull();
    expect(roundTripDelaySec(new Float32Array(10), 0, 0, [1])).toBeNull();
  });
});

describe('record offset', () => {
  it('clamps to the slider range and rejects junk', () => {
    expect(clampRecordOffsetMs(120.4)).toBe(120);
    expect(clampRecordOffsetMs(9999)).toBe(RECORD_OFFSET_MAX_MS);
    expect(clampRecordOffsetMs(-9999)).toBe(RECORD_OFFSET_MIN_MS);
    expect(clampRecordOffsetMs(Number.NaN)).toBe(0);
  });

  it('is saved per device and read back', () => {
    const storage = memoryStorage();
    expect(readRecordOffsetMs(storage)).toBe(0);
    expect(saveRecordOffsetMs(135, storage)).toBe(135);
    expect(storage.data.get(RECORD_OFFSET_KEY)).toBe('135');
    expect(readRecordOffsetMs(storage)).toBe(135);
    storage.data.set(RECORD_OFFSET_KEY, 'abc');
    expect(readRecordOffsetMs(storage)).toBe(0);
    expect(readRecordOffsetMs(null)).toBe(0);
  });

  it('shows the headphones reminder once', () => {
    const storage = memoryStorage();
    expect(takeHeadphonesHint(storage)).toBe(true);
    expect(storage.data.get(HEADPHONES_HINT_KEY)).toBe('shown');
    expect(takeHeadphonesHint(storage)).toBe(false);
    expect(takeHeadphonesHint(null)).toBe(true);
  });
});

describe('setRecordingAudioSession', () => {
  it('switches an iOS audio session to play-and-record and back', () => {
    const nav = { audioSession: { type: 'playback' } } as unknown as Navigator;
    const session = (nav as unknown as { audioSession: { type: string } }).audioSession;
    setRecordingAudioSession(true, nav);
    expect(session.type).toBe('play-and-record');
    setRecordingAudioSession(false, nav);
    expect(session.type).toBe('playback');
  });

  it('does nothing without the API and survives a read-only session', () => {
    expect(() => setRecordingAudioSession(true, {} as Navigator)).not.toThrow();
    expect(() => setRecordingAudioSession(true, undefined)).not.toThrow();
    const frozen = { audioSession: Object.freeze({ type: 'playback' }) } as unknown as Navigator;
    expect(() => setRecordingAudioSession(true, frozen)).not.toThrow();
  });
});

describe('grooveFillBars', () => {
  it('is never shorter than the minimum', () => {
    expect(grooveFillBars(0, 0, 4)).toBe(GROOVE_MIN_BARS);
    expect(grooveFillBars(8, 16, 4)).toBe(GROOVE_MIN_BARS);
  });

  it('reaches the end of a longer song', () => {
    expect(grooveFillBars(0, 130, 4)).toBe(33);
    expect(grooveFillBars(16, 144, 4)).toBe(32);
    expect(grooveFillBars(0, 120, 6)).toBe(20);
  });
});

describe('mp3 export', () => {
  it('converts floats to 16-bit with gain and clipping', () => {
    const out = floatToInt16(new Float32Array([0, 0.5, -0.5, 1, -1, 2]), 1);
    expect(Array.from(out)).toEqual([0, 16384, -16384, 32767, -32768, 32767]);
    expect(Array.from(floatToInt16(new Float32Array([0.25]), 2))).toEqual([16384]);
  });

  it('raises quiet mixes to the share peak and leaves loud or silent ones alone', () => {
    const target = 10 ** (-1 / 20);
    expect(sharePeakGain([new Float32Array([0.1, -0.2])])).toBeCloseTo(target / 0.2, 5);
    expect(sharePeakGain([new Float32Array([0.99])])).toBe(1);
    expect(sharePeakGain([new Float32Array([0, 0])])).toBe(1);
    expect(sharePeakGain([new Float32Array([0.0001])])).toBeCloseTo(10 ** (18 / 20), 5);
  });

  it('encodes a stereo buffer to an MP3 stream', async () => {
    const sampleRate = 44100;
    const frames = sampleRate; // one second
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      left[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
      right[i] = 0.3 * Math.sin((2 * Math.PI * 660 * i) / sampleRate);
    }
    const buffer = {
      numberOfChannels: 2,
      sampleRate,
      length: frames,
      getChannelData: (ch: number) => (ch === 0 ? left : right),
    } as unknown as AudioBuffer;
    const blob = await audioBufferToMp3(buffer);
    expect(blob.type).toBe('audio/mpeg');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // 192 kbps for one second is about 24 kB; an MP3 frame starts with the sync word.
    expect(bytes.length).toBeGreaterThan(18000);
    expect(bytes.length).toBeLessThan(32000);
    expect(bytes[0]).toBe(0xff);
    expect((bytes[1] ?? 0) & 0xe0).toBe(0xe0);
  });
});
