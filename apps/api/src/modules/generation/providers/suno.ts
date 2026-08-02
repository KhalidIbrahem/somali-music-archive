/**
 * Suno provider — via the third-party reseller API at api.sunoapi.org.
 *
 * IMPORTANT CONTEXT: Suno has NO official public API (partner-only as of
 * Jul 2026). This client targets the documented reseller surface and is only
 * active when SUNO_API_KEY is set — an explicit user decision; SETUP.md states
 * the ToS/commercial-rights caveats plainly.
 *
 * Flow is genuinely asynchronous: submit returns a taskId, results arrive by
 * poll-through (GET /record-info) whenever a client polls OUR job endpoint.
 * The reseller REQUIRES a callBackUrl; we point it at our no-op
 * /api/v1/generate/callback (never trusted — see generation.routes.ts) and
 * NEVER depend on it: in local dev it is unreachable from the internet, which
 * is why CALLBACK_EXCEPTION is mapped defensively below.
 *
 * Verified against https://docs.sunoapi.org (Aug 2026):
 *   POST /api/v1/generate  { customMode, instrumental, model, callBackUrl, prompt }
 *     → { code, msg, data: { taskId } }
 *   GET  /api/v1/generate/record-info?taskId=…
 *     → { code, msg, data: { status, errorMessage, response: { sunoData: [...] } } }
 */

import { z } from 'zod';
import type { GenerateRequestInput } from '@sma/validators';
import type { MusicProviderClient, PollResult, ProviderTrack, SubmitResult } from './provider';

export interface SunoConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  /** Reseller model version (V4, V4_5, V5, …). */
  readonly model: string;
  /** Absolute URL of our no-op callback endpoint (reseller requires one). */
  readonly callbackUrl: string;
  readonly timeoutMs: number;
}

const submitResponseSchema = z
  .object({
    code: z.number(),
    msg: z.string().optional(),
    data: z.object({ taskId: z.string().min(1) }).nullish(),
  })
  .passthrough();

const sunoTrackSchema = z
  .object({
    audioUrl: z.string().optional(),
    streamAudioUrl: z.string().optional(),
    title: z.string().optional(),
    duration: z.number().optional(),
    prompt: z.string().optional(),
  })
  .passthrough();

const pollResponseSchema = z
  .object({
    code: z.number(),
    msg: z.string().optional(),
    data: z
      .object({
        status: z.string(),
        errorMessage: z.string().nullish(),
        response: z.object({ sunoData: z.array(sunoTrackSchema).optional() }).nullish(),
      })
      .nullish(),
  })
  .passthrough();

/** Reseller statuses that mean "still working — poll again". */
const RUNNING_STATUSES = new Set(['PENDING', 'TEXT_SUCCESS', 'FIRST_SUCCESS']);
const FAILED_STATUS_MESSAGES: Record<string, string> = {
  CREATE_TASK_FAILED: 'Suno could not start the generation task',
  GENERATE_AUDIO_FAILED: 'Suno failed while generating the audio',
  SENSITIVE_WORD_ERROR: 'Suno rejected the prompt (flagged content)',
};

export class SunoProvider implements MusicProviderClient {
  readonly name = 'suno' as const;

  constructor(private readonly cfg: SunoConfig) {}

  isConfigured(): boolean {
    return this.cfg.apiKey.length > 0;
  }

  async submit(input: GenerateRequestInput): Promise<SubmitResult> {
    // Non-custom mode: the reseller writes lyrics/style from the one prompt
    // (custom mode requires separate style/title fields and longer prompts).
    const body = {
      customMode: false,
      instrumental: input.instrumental,
      model: input.model ?? this.cfg.model,
      callBackUrl: this.cfg.callbackUrl,
      prompt: input.prompt,
    };

    const json = await this.request('POST', '/api/v1/generate', body);
    const parsed = submitResponseSchema.safeParse(json);
    if (!parsed.success) throw new Error('Suno returned an unexpected submit response');
    if (parsed.data.code !== 200 || !parsed.data.data) {
      throw new Error(`Suno rejected the request${suffix(parsed.data.msg)}`);
    }
    return { kind: 'pending', externalId: parsed.data.data.taskId };
  }

  async poll(externalId: string): Promise<PollResult> {
    const json = await this.request(
      'GET',
      `/api/v1/generate/record-info?taskId=${encodeURIComponent(externalId)}`,
    );
    const parsed = pollResponseSchema.safeParse(json);
    if (!parsed.success || parsed.data.code !== 200 || !parsed.data.data) {
      // Transport-level weirdness — treat as still running; the service's next
      // poll retries and the job TTL bounds the worst case.
      return { state: 'running' };
    }

    const { status, errorMessage, response } = parsed.data.data;
    const first = response?.sunoData?.[0];
    const audioUrl = first?.audioUrl ?? first?.streamAudioUrl;

    if (RUNNING_STATUSES.has(status)) return { state: 'running' };

    const failureMessage = FAILED_STATUS_MESSAGES[status];
    if (failureMessage) {
      return { state: 'failed', error: `${failureMessage}${suffix(errorMessage)}` };
    }

    // SUCCESS — and, defensively, CALLBACK_EXCEPTION with audio present: our
    // callback is unreachable from the reseller in local dev, and the audio is
    // finished regardless of whether the webhook could be delivered.
    if (status === 'SUCCESS' || status === 'CALLBACK_EXCEPTION') {
      if (!first || !audioUrl) {
        return { state: 'failed', error: 'Suno reported success but returned no audio' };
      }
      const track: ProviderTrack = {
        audio: { kind: 'url', url: audioUrl, mimeType: 'audio/mpeg' },
        ...(first.duration ? { durationSec: Math.round(first.duration) } : {}),
        ...(first.title ? { title: first.title } : {}),
        ...(first.prompt ? { lyrics: first.prompt } : {}),
      };
      return { state: 'succeeded', track };
    }

    // Unknown/new status value — stay lenient, keep polling until the TTL.
    return { state: 'running' };
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.cfg.apiKey}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (cause) {
      const isTimeout =
        cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
      const err = new Error(
        isTimeout
          ? `Suno timed out after ${Math.round(this.cfg.timeoutMs / 1000)}s`
          : 'Could not reach the Suno API',
      );
      err.cause = cause;
      throw err;
    }
    if (!res.ok) throw new Error(`Suno request failed (HTTP ${res.status})`);
    return res.json();
  }
}

/** Append a provider message safely: sanitised elsewhere, kept short here. */
function suffix(msg: string | null | undefined): string {
  return msg ? `: ${msg}` : '';
}
