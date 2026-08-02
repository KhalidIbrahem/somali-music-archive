/**
 * AI music-generation providers and job lifecycle states.
 *
 * WHY these live in @sma/constants and not @sma/types: these are RUNTIME values
 * (z.enum sources for @sma/validators, provider registries in the API) and
 * @sma/types is type-only by contract. Same const-asserted-tuple rationale as
 * GENRES — the strings are persisted in job records and sent over the wire, so
 * a literal union keeps every workspace agreeing on exactly one spelling.
 *
 * Append-only: adding a provider (e.g. a second reseller, a self-hosted model
 * id) is safe; removing one would orphan stored jobs that reference it.
 */

/**
 * The generation backends the API can route to.
 *   suno  — Suno models via a third-party reseller API (no official public API).
 *   lyria — Google Lyria 3 via the official Gemini API (synchronous).
 *   local — the archive's own fine-tuned model served by the Python ai-service
 *           (gated until corpus licensing clears; the swap-in path for MusicGen
 *           LoRA checkpoints once training hardware arrives).
 */
export const MUSIC_PROVIDERS = ['suno', 'lyria', 'local'] as const;
export type MusicProvider = (typeof MUSIC_PROVIDERS)[number];

/**
 * Lifecycle of a generation job as clients observe it.
 *   queued    — accepted, not yet handed to the provider
 *   running   — provider is generating (poll again)
 *   succeeded — the track is ready
 *   failed    — a safe, human-readable error is attached
 */
export const GENERATION_JOB_STATES = ['queued', 'running', 'succeeded', 'failed'] as const;
export type GenerationJobState = (typeof GENERATION_JOB_STATES)[number];

/** Runtime guard — validates untrusted input is a known provider. */
export function isMusicProvider(value: unknown): value is MusicProvider {
  return typeof value === 'string' && (MUSIC_PROVIDERS as readonly string[]).includes(value);
}
