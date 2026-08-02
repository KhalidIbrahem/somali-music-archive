/**
 * Fake provider — dev/test stand-in when a real provider's key is absent
 * (mirrors FakeStripeGateway). Lets the whole generate→poll→play loop run
 * end-to-end with zero keys and zero network: submit() returns a pending task,
 * poll() succeeds once ~3 seconds have elapsed.
 *
 * STATELESS BY DESIGN: readiness is encoded in the externalId itself
 * (`fake:<epochMs>`), not in instance state, so the flow still works when
 * submit and poll land on different serverless instances — exactly like the
 * real async providers it imitates.
 */

import type { MusicProvider } from '@sma/constants';
import type { GenerateRequestInput } from '@sma/validators';
import type { MusicProviderClient, PollResult, ProviderTrack, SubmitResult } from './provider';

/** How long the fake "generates" before poll() reports success. */
const FAKE_GENERATION_MS = 3_000;

/** Build a minimal valid WAV (8-bit PCM mono 8kHz silence) — universally playable. */
function silentWav(seconds: number): Uint8Array {
  const sampleRate = 8_000;
  const dataLen = Math.max(1, Math.round(seconds * sampleRate));
  const buf = Buffer.alloc(44 + dataLen, 0x80); // 0x80 = silence midpoint in 8-bit PCM
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVEfmt ', 8, 'ascii');
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate, 28); // byte rate (8-bit mono)
  buf.writeUInt16LE(1, 32); // block align
  buf.writeUInt16LE(8, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataLen, 40);
  return new Uint8Array(buf);
}

export class FakeMusicProvider implements MusicProviderClient {
  constructor(
    readonly name: MusicProvider,
    private readonly now: () => number = Date.now,
  ) {}

  isConfigured(): boolean {
    return true;
  }

  async submit(_input: GenerateRequestInput): Promise<SubmitResult> {
    return { kind: 'pending', externalId: `fake:${this.now()}` };
  }

  async poll(externalId: string): Promise<PollResult> {
    const startedAt = Number(externalId.split(':')[1] ?? 0);
    if (!Number.isFinite(startedAt) || startedAt <= 0) {
      return { state: 'failed', error: 'Unknown fake task' };
    }
    if (this.now() - startedAt < FAKE_GENERATION_MS) return { state: 'running' };

    const track: ProviderTrack = {
      audio: { kind: 'bytes', data: silentWav(1), mimeType: 'audio/wav' },
      durationSec: 1,
      title: 'Fake generated track (dev)',
      lyrics: `[${this.name} fake] Configure a real API key to generate actual music.`,
    };
    return { state: 'succeeded', track };
  }
}
