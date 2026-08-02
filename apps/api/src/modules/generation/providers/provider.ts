/**
 * The provider-agnostic music-generation interface (ADR-0005 interface-first,
 * mirroring stripeGateway).
 *
 * Everything above this interface — job store, service, routes, both apps —
 * is provider-blind. Suno (async task+poll), Lyria (synchronous single call),
 * the dev fake, and the future fine-tuned local model all normalise onto
 * submit()/poll(). Swapping in the archive's own model is exactly one new
 * class implementing this interface plus a registry line.
 *
 * Error contract: submit/poll THROW plain Errors with client-safe generic
 * messages (never provider response bodies); the service catches, logs the
 * cause, and stores the message on the failed job. Unconfigured providers are
 * gated by isConfigured() before submit is ever called.
 */

import type { MusicProvider } from '@sma/constants';
import type { GenerateRequestInput } from '@sma/validators';

/** Audio as a provider hands it back — raw bytes (Lyria) or a hosted URL (Suno). */
export type GeneratedAudioPayload =
  | { readonly kind: 'bytes'; readonly data: Uint8Array; readonly mimeType: string }
  | { readonly kind: 'url'; readonly url: string; readonly mimeType: string };

/** A finished track in provider-neutral terms (pre-persistence). */
export interface ProviderTrack {
  readonly audio: GeneratedAudioPayload;
  readonly durationSec?: number;
  readonly title?: string;
  readonly lyrics?: string;
}

export type SubmitResult =
  | { readonly kind: 'completed'; readonly track: ProviderTrack }
  | { readonly kind: 'pending'; readonly externalId: string };

export type PollResult =
  | { readonly state: 'running' }
  | { readonly state: 'succeeded'; readonly track: ProviderTrack }
  | { readonly state: 'failed'; readonly error: string };

export interface MusicProviderClient {
  readonly name: MusicProvider;
  /** False → the service answers 503 GENERATION_PROVIDER_UNAVAILABLE up front. */
  isConfigured(): boolean;
  /** Hand the request to the provider. Sync providers complete here. */
  submit(input: GenerateRequestInput): Promise<SubmitResult>;
  /** Check an async provider's task. Only called with a submit()-issued externalId. */
  poll(externalId: string): Promise<PollResult>;
}
