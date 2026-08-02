/**
 * AI music-generation contracts (Suno / Lyria proxy — SESSION P5 generation).
 *
 * These are the PROVIDER-AGNOSTIC wire types the web and mobile apps use to ask
 * the Node API to generate a track and to poll for the result. Deliberately no
 * Suno/Lyria-specific fields leak here: the whole point of the abstraction is
 * that a future self-hosted / fine-tuned model (`local`) drops in behind the
 * exact same contract without any app change (ARCHITECTURE.md ADR-0005,
 * interface-first). The Node service normalises every provider — synchronous
 * (Lyria returns audio in one call) or asynchronous (Suno returns a task id you
 * poll) — onto this single job shape, so the apps always submit then poll.
 *
 * The provider/state string lists are RUNTIME constants and therefore live in
 * @sma/constants (this package is type-only); they are re-exported here as
 * types so consumers of the wire contract need only @sma/types.
 */

import type { GenerationJobState, MusicProvider } from '@sma/constants';

export type { GenerationJobState, MusicProvider };

/** What the app sends to POST /generate. Mirrors `generateRequestSchema`. */
export interface GenerationRequest {
  readonly provider: MusicProvider;
  /** Natural-language description of the music to generate. */
  readonly prompt: string;
  /** Target length in seconds (provider clamps to its own limits). */
  readonly durationSec?: number;
  /** Instrumental only — no vocals/lyrics. */
  readonly instrumental?: boolean;
  /** Optional human title for the resulting track. */
  readonly title?: string;
  /** Provider-specific model override (e.g. a Lyria model id). Advanced use. */
  readonly model?: string;
}

/** The finished audio, once a job succeeds. */
export interface GeneratedTrack {
  /**
   * Where the audio lives. One of: a provider-hosted https URL (Suno), a signed
   * R2 playback URL (Lyria in production — re-signed fresh on every poll), or a
   * `data:` URI carrying the bytes inline (Lyria in keyless/dev mode). The apps
   * treat it as an opaque, directly-playable source.
   */
  readonly audioUrl: string;
  readonly mimeType: string;
  readonly durationSec?: number;
  readonly title?: string;
  /** Generated lyrics / song structure, when the provider returns them. */
  readonly lyrics?: string;
}

/** A generation job — the single object POST returns and GET polls. */
export interface GenerationJob {
  readonly id: string;
  readonly provider: MusicProvider;
  readonly state: GenerationJobState;
  readonly prompt: string;
  /** ISO-8601. */
  readonly createdAt: string;
  /** ISO-8601. */
  readonly updatedAt: string;
  /** Present iff state === 'succeeded'. */
  readonly track?: GeneratedTrack;
  /** Present iff state === 'failed' — a safe, human-readable reason. */
  readonly error?: string;
}
