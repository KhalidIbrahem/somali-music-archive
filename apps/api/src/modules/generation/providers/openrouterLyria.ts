/**
 * Lyria via OpenRouter — an alternate TRANSPORT for the same `lyria` provider.
 *
 * OpenRouter resells Google's Lyria 3 models (google/lyria-3-clip-preview,
 * google/lyria-3-pro-preview) through its OpenAI-compatible chat-completions
 * surface, letting existing OpenRouter credits pay for generation instead of
 * Google billing. The registry picks this class over the direct Gemini client
 * whenever OPENROUTER_API_KEY is set.
 *
 * Verified against https://openrouter.ai/docs (Aug 2026): POST
 * {base}/chat/completions with `modalities: ["text","audio"]` and
 * `audio: { format }`; **audio output requires `stream: true`** — the result
 * arrives as SSE chunks whose base64 audio segments live at
 * `choices[0].delta.audio.data` (transcript text at `.transcript`). Each
 * chunk's base64 is decoded independently and the byte buffers concatenated.
 * Like the direct client, generation completes inside this one call, so
 * submit() resolves to `completed` and poll() is defensively unreachable.
 */

import type { GenerateRequestInput } from '@sma/validators';
import type { MusicProviderClient, PollResult, ProviderTrack, SubmitResult } from './provider';

export interface OpenRouterLyriaConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  /** OpenRouter model slug, e.g. google/lyria-3-clip-preview. */
  readonly model: string;
  readonly timeoutMs: number;
}

/** Safely pluck audio + text from `choices[0].delta` / `choices[0].message`. */
function audioPartOf(chunk: unknown): { data?: string; transcript?: string; text?: string } {
  if (typeof chunk !== 'object' || chunk === null) return {};
  const choices = (chunk as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return {};
  const first = choices[0] as { delta?: unknown; message?: unknown };
  for (const part of [first.delta, first.message]) {
    if (typeof part !== 'object' || part === null) continue;
    const { audio, content } = part as { audio?: unknown; content?: unknown };
    const text = typeof content === 'string' && content.length > 0 ? { text: content } : {};
    if (typeof audio !== 'object' || audio === null) {
      if ('text' in text) return text;
      continue;
    }
    const { data, transcript } = audio as { data?: unknown; transcript?: unknown };
    return {
      ...(typeof data === 'string' ? { data } : {}),
      ...(typeof transcript === 'string' ? { transcript } : {}),
      ...text,
    };
  }
  return {};
}

export class OpenRouterLyriaProvider implements MusicProviderClient {
  readonly name = 'lyria' as const;

  constructor(private readonly cfg: OpenRouterLyriaConfig) {}

  isConfigured(): boolean {
    return this.cfg.apiKey.length > 0;
  }

  async submit(input: GenerateRequestInput): Promise<SubmitResult> {
    // A bare model override maps onto OpenRouter's google/ namespace, so the
    // same request body works against either lyria transport.
    const model = input.model
      ? input.model.includes('/')
        ? input.model
        : `google/${input.model}`
      : this.cfg.model;

    const parts = [input.prompt];
    if (input.instrumental) parts.push('Instrumental only — no vocals or lyrics.');
    if (input.durationSec) parts.push(`Aim for roughly ${input.durationSec} seconds.`);

    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.cfg.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: parts.join(' ') }],
          modalities: ['text', 'audio'],
          audio: { format: 'mp3' },
          stream: true, // REQUIRED for audio output (SSE)
        }),
        // One signal covers the request AND the body read below.
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (cause) {
      throw this.asSafeError(cause);
    }
    if (!res.ok) throw await this.httpError(res);

    const { bytes, transcript, text } = await this.collectSse(res);
    if (bytes.length === 0) {
      // A text-only stream usually means the model REFUSED (e.g. Lyria
      // declines prompts naming a real artist) — surface its words so the
      // user learns why instead of a bare "no audio".
      const reason = text
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      throw new Error(
        reason
          ? `Lyria returned no audio — model said: ${reason.slice(0, 180)}`
          : 'OpenRouter returned no audio (the model may have declined the prompt — avoid naming real artists)',
      );
    }

    const track: ProviderTrack = {
      audio: { kind: 'bytes', data: new Uint8Array(bytes), mimeType: 'audio/mpeg' },
      ...(input.durationSec ? { durationSec: input.durationSec } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(transcript ? { lyrics: transcript } : {}),
    };
    return { kind: 'completed', track };
  }

  /** Unreachable by design — generation completes inside submit(). */
  async poll(_externalId: string): Promise<PollResult> {
    return { state: 'failed', error: 'OpenRouter generations complete at submission' };
  }

  /** Drain the SSE stream, decoding each base64 audio segment as it arrives. */
  private async collectSse(
    res: Response,
  ): Promise<{ bytes: Buffer; transcript: string; text: string }> {
    const body = res.body;
    if (!body) throw new Error('OpenRouter returned an empty stream');

    const decoder = new TextDecoder();
    const audio: Buffer[] = [];
    let transcript = '';
    let text = '';
    let pending = '';

    const reader = body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        // SSE frames are newline-delimited; keep the trailing partial line.
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          const data = line.startsWith('data:') ? line.slice(5).trim() : '';
          if (!data || data === '[DONE]') continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue; // tolerate keep-alive/malformed frames
          }
          const part = audioPartOf(parsed);
          if (part.data) audio.push(Buffer.from(part.data, 'base64'));
          if (part.transcript) transcript += part.transcript;
          if (part.text) text += part.text;
        }
      }
    } catch (cause) {
      throw this.asSafeError(cause);
    }
    return { bytes: Buffer.concat(audio), transcript, text };
  }

  /** Map an HTTP failure to a client-safe message (credits get a clear one). */
  private async httpError(res: Response): Promise<Error> {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: { message?: unknown } };
      if (typeof body.error?.message === 'string') detail = body.error.message.slice(0, 200);
    } catch {
      // non-JSON error body — keep the generic message
    }
    if (res.status === 402) {
      return new Error('OpenRouter credits exhausted — top up at openrouter.ai/credits');
    }
    return new Error(
      detail
        ? `OpenRouter request failed (HTTP ${res.status}): ${detail}`
        : `OpenRouter request failed (HTTP ${res.status})`,
    );
  }

  private asSafeError(cause: unknown): Error {
    const isTimeout =
      cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
    const err = new Error(
      isTimeout
        ? `OpenRouter timed out after ${Math.round(this.cfg.timeoutMs / 1000)}s`
        : 'Could not reach the OpenRouter API',
    );
    err.cause = cause;
    return err;
  }
}
