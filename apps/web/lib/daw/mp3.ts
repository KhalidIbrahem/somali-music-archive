/**
 * MP3 encoding for sharing — a rendered mix as a small file a phone can send
 * (a 30 s mix is ~5 MB as WAV, ~0.7 MB as MP3). The encoder (lamejs, LGPL-3.0,
 * unmodified) is loaded on demand, so it costs nothing until someone exports.
 */

export const MP3_KBPS = 192;
const MP3_FRAME = 1152;
/** Quiet mixes are raised so their peak sits here (dBFS); loud ones are left alone. */
export const SHARE_PEAK_DB = -1;

/** Float samples (−1…1) to 16-bit PCM, with `gain` applied and clipping guarded. */
export function floatToInt16(samples: Float32Array, gain = 1): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, (samples[i] ?? 0) * gain));
    out[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
  }
  return out;
}

/**
 * Gain that lifts the loudest sample of `channels` to SHARE_PEAK_DB. Never
 * below 1 (a mix already at the limiter is untouched), never above +18 dB
 * (silence and near-silence are not blown up into noise).
 */
export function sharePeakGain(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] ?? 0));
  }
  if (peak <= 0) return 1;
  const target = 10 ** (SHARE_PEAK_DB / 20);
  return Math.max(1, Math.min(10 ** (18 / 20), target / peak));
}

export async function audioBufferToMp3(buffer: AudioBuffer, kbps = MP3_KBPS): Promise<Blob> {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const channels = Math.min(2, buffer.numberOfChannels);
  const data: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) data.push(buffer.getChannelData(ch));
  const gain = sharePeakGain(data);
  const left = floatToInt16(data[0] ?? new Float32Array(0), gain);
  const right = channels > 1 ? floatToInt16(data[1] ?? new Float32Array(0), gain) : null;
  const encoder = new Mp3Encoder(channels, buffer.sampleRate, kbps);
  const parts: BlobPart[] = [];
  const push = (chunk: Uint8Array): void => {
    if (chunk.length === 0) return;
    const copy = new Uint8Array(chunk.length);
    copy.set(chunk);
    parts.push(copy.buffer);
  };
  for (let i = 0; i < left.length; i += MP3_FRAME) {
    const l = left.subarray(i, i + MP3_FRAME);
    push(
      right ? encoder.encodeBuffer(l, right.subarray(i, i + MP3_FRAME)) : encoder.encodeBuffer(l),
    );
  }
  push(encoder.flush());
  return new Blob(parts, { type: 'audio/mpeg' });
}

/** True when this browser can hand `file` to the system share sheet (phones, mostly). */
export function canShareFile(file: File): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}
