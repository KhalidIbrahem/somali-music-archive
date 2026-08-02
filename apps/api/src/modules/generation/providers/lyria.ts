/**
 * Google Lyria provider — the official Gemini API Interactions surface.
 *
 * Lyria is SYNCHRONOUS: one POST returns the finished audio (base64) in tens of
 * seconds, so submit() resolves straight to `completed` and poll() is never
 * reachable in practice. The service's budgeted-submit + waitUntil design
 * exists precisely for this call shape.
 *
 * Verified against https://ai.google.dev/gemini-api/docs/music-generation
 * (Aug 2026): POST /v1beta/interactions, header `x-goog-api-key`, body
 * { model, input }, response carries `output_audio` (base64 MP3 by default)
 * and `output_text` (lyrics/structure). Models: lyria-3-clip-preview (~30s),
 * lyria-3-pro-preview (~2min).
 */

import { z } from 'zod';
import type { GenerateRequestInput } from '@sma/validators';
import type { MusicProviderClient, PollResult, ProviderTrack, SubmitResult } from './provider';

export interface LyriaConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  /** Overridable for tests; defaults to the real Gemini API host. */
  readonly baseUrl?: string;
}

/** The slice of the interaction response we rely on; everything else ignored. */
const lyriaResponseSchema = z
  .object({
    output_audio: z.string().min(1).optional(),
    output_text: z.string().optional(),
  })
  .passthrough();

export class LyriaProvider implements MusicProviderClient {
  readonly name = 'lyria' as const;
  private readonly baseUrl: string;

  constructor(private readonly cfg: LyriaConfig) {
    this.baseUrl = cfg.baseUrl ?? 'https://generativelanguage.googleapis.com';
  }

  isConfigured(): boolean {
    return this.cfg.apiKey.length > 0;
  }

  async submit(input: GenerateRequestInput): Promise<SubmitResult> {
    const model = input.model ?? this.cfg.model;
    // Lyria takes one natural-language input; fold the structured knobs in.
    const parts = [input.prompt];
    if (input.instrumental) parts.push('Instrumental only — no vocals or lyrics.');
    if (input.durationSec) parts.push(`Aim for roughly ${input.durationSec} seconds.`);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1beta/interactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.cfg.apiKey },
        body: JSON.stringify({ model, input: parts.join(' ') }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (cause) {
      throw this.asSafeError(cause);
    }
    if (!res.ok) {
      // Body deliberately not surfaced to clients; the service logs the cause.
      throw new Error(`Lyria request failed (HTTP ${res.status})`);
    }

    const parsed = lyriaResponseSchema.safeParse(await res.json());
    if (!parsed.success || !parsed.data.output_audio) {
      throw new Error('Lyria returned no audio');
    }

    const track: ProviderTrack = {
      audio: {
        kind: 'bytes',
        data: new Uint8Array(Buffer.from(parsed.data.output_audio, 'base64')),
        mimeType: 'audio/mpeg',
      },
      ...(input.durationSec ? { durationSec: input.durationSec } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(parsed.data.output_text ? { lyrics: parsed.data.output_text } : {}),
    };
    return { kind: 'completed', track };
  }

  /** Unreachable by design — Lyria completes inside submit(). Defensive only. */
  async poll(_externalId: string): Promise<PollResult> {
    return { state: 'failed', error: 'Lyria generations complete at submission' };
  }

  private asSafeError(cause: unknown): Error {
    const isTimeout =
      cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
    const err = new Error(
      isTimeout
        ? `Lyria timed out after ${Math.round(this.cfg.timeoutMs / 1000)}s`
        : 'Could not reach the Lyria API',
    );
    err.cause = cause;
    return err;
  }
}
