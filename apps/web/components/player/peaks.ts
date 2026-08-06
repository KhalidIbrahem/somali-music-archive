/**
 * Waveform peaks for the player scrubber (B1-15).
 *
 * Decodes at 8kHz in a throwaway OfflineAudioContext-compatible AudioContext
 * so a seven-minute 320kbps track costs ~25MB transiently instead of ~300MB,
 * then reduces to min/max column pairs and releases the buffer. Results are
 * cached per URL. Returns null when decoding is impossible — the scrubber
 * then renders its designed flat bed instead of an error.
 */

export interface Peaks {
  mins: Float32Array;
  maxs: Float32Array;
  duration: number;
}

const cache = new Map<string, Peaks | null>();

export async function loadPeaks(src: string, columns = 600): Promise<Peaks | null> {
  const cached = cache.get(src);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`peaks fetch ${res.status}`);
    const bytes = await res.arrayBuffer();
    const ctx = new AudioContext({ sampleRate: 8000 });
    const buffer = await ctx.decodeAudioData(bytes);
    void ctx.close();
    const data = buffer.getChannelData(0);
    const mins = new Float32Array(columns);
    const maxs = new Float32Array(columns);
    const per = data.length / columns;
    for (let c = 0; c < columns; c++) {
      let lo = 1;
      let hi = -1;
      const s0 = Math.floor(c * per);
      const s1 = Math.min(data.length, Math.ceil((c + 1) * per));
      const stride = Math.max(1, Math.floor((s1 - s0) / 32));
      for (let s = s0; s < s1; s += stride) {
        const v = data[s] ?? 0;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      mins[c] = lo;
      maxs[c] = hi;
    }
    const peaks: Peaks = { mins, maxs, duration: buffer.duration };
    cache.set(src, peaks);
    return peaks;
  } catch {
    cache.set(src, null);
    return null;
  }
}
