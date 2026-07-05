/**
 * Research API contracts (ARCHITECTURE.md §12 RESEARCH, SESSION P3-07).
 *
 * External researchers authenticate with an API key and pull the annotated corpus
 * (transcripts, Somali-scale pitch analysis) for ethnomusicology work. These are
 * the wire shapes: the key management surface (owned by a signed-in user) and the
 * dataset export projection (a research-facing view of a published recording).
 */

import type { ContentLanguage, Genre, Instrument, Region } from '@sma/constants';
import type { IsoDateTimeString, Uuid } from './common';
import type { PitchPoint, RecordingTitle } from './recording';

/** Access tier of a research key — sets the default rate limit and terms. */
export type ApiKeyPlan = 'academic' | 'commercial';

/** A research API key as shown to its owner (never includes the secret or hash). */
export interface PublicApiKey {
  readonly id: Uuid;
  readonly name: string;
  /** First chars of the key, for identification in the UI (e.g. "sma_A1b2C3d"). */
  readonly keyPrefix: string;
  readonly plan: ApiKeyPlan;
  /** Requests allowed per hour for this key. */
  readonly rateLimit: number;
  readonly lastUsedAt?: IsoDateTimeString;
  readonly expiresAt?: IsoDateTimeString;
  readonly createdAt: IsoDateTimeString;
}

/** Returned ONCE, at creation — the only time the plaintext key is ever available. */
export interface CreatedApiKey extends PublicApiKey {
  readonly key: string;
}

/** AI research fields exported per recording (pitch track is opt-in — it is large). */
export interface ResearchRecordingAi {
  readonly transcriptSomali?: string;
  readonly transcriptEnglish?: string;
  readonly isSinging?: boolean;
  readonly dominantNotes?: readonly string[];
  readonly voicedFraction?: number;
  readonly pitch?: readonly PitchPoint[];
}

/** A published recording projected for the dataset export. */
export interface ResearchRecording {
  readonly id: string;
  readonly title: RecordingTitle;
  readonly artist: string;
  readonly genre: Genre;
  readonly region?: Region;
  readonly era?: string;
  readonly instruments: readonly Instrument[];
  readonly language: ContentLanguage;
  readonly durationSec: number;
  readonly ai: ResearchRecordingAi;
  readonly createdAt: IsoDateTimeString;
}
