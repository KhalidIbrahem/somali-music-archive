import { base64ToBytes, parseWavPcm16, monoFloatWindow } from './wav';
import { detectPitch } from './pitch';

function writeTag(bytes: Uint8Array, offset: number, tag: string): void {
  for (let i = 0; i < tag.length; i += 1) bytes[offset + i] = tag.charCodeAt(i);
}

/** Build a 16-bit mono PCM WAV of a sine wave. */
function buildWav(freq: number, sampleRate: number, n: number): Uint8Array {
  const dataSize = n * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  writeTag(bytes, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeTag(bytes, 8, 'WAVE');
  writeTag(bytes, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeTag(bytes, 36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < n; i += 1) {
    view.setInt16(
      44 + i * 2,
      Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 30000),
      true,
    );
  }
  return bytes;
}

describe('base64ToBytes', () => {
  it('decodes a known string', () => {
    expect([...base64ToBytes('SGVsbG8=')]).toEqual([72, 101, 108, 108, 111]); // "Hello"
  });
});

describe('parseWavPcm16', () => {
  it('parses header fields and samples', () => {
    const pcm = parseWavPcm16(buildWav(440, 8000, 1024));
    expect(pcm).not.toBeNull();
    expect(pcm?.sampleRate).toBe(8000);
    expect(pcm?.channels).toBe(1);
    expect(pcm?.samples.length).toBe(1024);
  });

  it('rejects non-WAV bytes', () => {
    expect(parseWavPcm16(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  it('round-trips to a detectable pitch', () => {
    const pcm = parseWavPcm16(buildWav(440, 44100, 8192));
    expect(pcm).not.toBeNull();
    const window = monoFloatWindow(pcm!, 4096);
    const hz = detectPitch(window, pcm!.sampleRate);
    expect(hz as number).toBeGreaterThan(430);
    expect(hz as number).toBeLessThan(450);
  });
});
