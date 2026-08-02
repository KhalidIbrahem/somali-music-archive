/**
 * Local provider — the archive's own model, served by the Python ai-service.
 *
 * This is the swap-in path for the fine-tuned MusicGen/LoRA checkpoints once
 * training hardware arrives AND the corpus licensing gate clears. Today the
 * ai-service endpoint is deliberately gated (403 while GENERATION_ENABLED is
 * false, 501 once enabled but unimplemented); this client surfaces that as a
 * cleanly-failed job with an honest message, so the provider is selectable in
 * every environment without pretending to work.
 *
 * The ai-service is internal-only: authenticated with the shared internal key
 * (X-Internal-Key), same as the analysis pipeline (deps.py).
 */

import { z } from 'zod';
import type { GenerateRequestInput } from '@sma/validators';
import type { MusicProviderClient, PollResult, ProviderTrack, SubmitResult } from './provider';

export interface LocalConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
}

/** Forward-compatible response slice for when serving is implemented. */
const localResponseSchema = z
  .object({
    audio_base64: z.string().min(1).optional(),
    mime_type: z.string().optional(),
    duration_sec: z.number().optional(),
  })
  .passthrough();

const NOT_READY =
  'The archive’s own model is not yet available (corpus licensing pending — see ai-service GENERATION_ENABLED)';

export class LocalProvider implements MusicProviderClient {
  readonly name = 'local' as const;

  constructor(private readonly cfg: LocalConfig) {}

  /** Always selectable — unavailability is reported per-job, honestly. */
  isConfigured(): boolean {
    return true;
  }

  async submit(input: GenerateRequestInput): Promise<SubmitResult> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': this.cfg.apiKey },
        body: JSON.stringify({
          caption: input.prompt,
          // The gated endpoint caps at 30s; clamp rather than reject.
          seconds: Math.min(input.durationSec ?? 10, 30),
        }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (cause) {
      const err = new Error('Could not reach the local AI service');
      err.cause = cause;
      throw err;
    }

    // The deliberate gates — an expected state, not an exception.
    if (res.status === 403 || res.status === 501) throw new Error(NOT_READY);
    if (!res.ok) throw new Error(`Local AI service request failed (HTTP ${res.status})`);

    const parsed = localResponseSchema.safeParse(await res.json());
    if (!parsed.success || !parsed.data.audio_base64) {
      throw new Error('Local AI service returned an unexpected response');
    }
    const track: ProviderTrack = {
      audio: {
        kind: 'bytes',
        data: new Uint8Array(Buffer.from(parsed.data.audio_base64, 'base64')),
        mimeType: parsed.data.mime_type ?? 'audio/wav',
      },
      ...(parsed.data.duration_sec ? { durationSec: parsed.data.duration_sec } : {}),
      ...(input.title ? { title: input.title } : {}),
    };
    return { kind: 'completed', track };
  }

  /** Unreachable — the local service completes (or fails) at submit. */
  async poll(_externalId: string): Promise<PollResult> {
    return { state: 'failed', error: NOT_READY };
  }
}
