/**
 * Minimal WAV (LINEAR PCM 16-bit) decoding for the pitch exercise. expo-av records
 * WAV on iOS; expo-file-system reads it as base64; these pure, tested helpers turn
 * that into a mono sample window we can run pitch detection over. No native deps.
 */

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decode a base64 string to bytes (padding-tolerant; a few trailing bytes may be
 * dropped, which is harmless for windowed pitch analysis). */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const outLen = Math.floor((clean.length * 3) / 4);
  const bytes = new Uint8Array(outLen);
  let pos = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64_CHARS.indexOf(clean[i] ?? 'A') << 18) |
      (B64_CHARS.indexOf(clean[i + 1] ?? 'A') << 12) |
      (B64_CHARS.indexOf(clean[i + 2] ?? 'A') << 6) |
      B64_CHARS.indexOf(clean[i + 3] ?? 'A');
    if (pos < outLen) bytes[pos++] = (n >> 16) & 0xff;
    if (pos < outLen) bytes[pos++] = (n >> 8) & 0xff;
    if (pos < outLen) bytes[pos++] = n & 0xff;
  }
  return bytes;
}

export interface WavPcm {
  sampleRate: number;
  channels: number;
  /** Interleaved 16-bit samples. */
  samples: Int16Array;
}

function readTag(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

/** Parse a 16-bit PCM WAV. Returns null if it is not a PCM WAV we understand. */
export function parseWavPcm16(bytes: Uint8Array): WavPcm | null {
  if (bytes.length < 44 || readTag(bytes, 0) !== 'RIFF' || readTag(bytes, 8) !== 'WAVE') {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sampleRate = 0;
  let channels = 1;

  // Walk chunks from byte 12.
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const tag = readTag(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (tag === 'fmt ') {
      channels = view.getUint16(body + 2, true) || 1;
      sampleRate = view.getUint32(body + 4, true);
    } else if (tag === 'data') {
      const count = Math.floor(Math.min(size, bytes.length - body) / 2);
      const samples = new Int16Array(count);
      for (let i = 0; i < count; i += 1) {
        samples[i] = view.getInt16(body + i * 2, true);
      }
      if (sampleRate <= 0) return null;
      return { sampleRate, channels, samples };
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }
  return null;
}

/** Extract a normalised (-1..1) mono window from parsed PCM, centred in the clip. */
export function monoFloatWindow(pcm: WavPcm, windowSize = 4096): number[] {
  const frames = Math.floor(pcm.samples.length / pcm.channels);
  const count = Math.min(windowSize, frames);
  const start = Math.max(0, Math.floor((frames - count) / 2));
  const out = new Array<number>(count);
  for (let i = 0; i < count; i += 1) {
    // Take channel 0 of each interleaved frame.
    out[i] = (pcm.samples[(start + i) * pcm.channels] ?? 0) / 32768;
  }
  return out;
}
