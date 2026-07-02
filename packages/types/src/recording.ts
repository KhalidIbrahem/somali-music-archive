/**
 * Recording — the core data unit of the archive.
 *
 * Mirrors the MongoDB Recording document (ARCHITECTURE.md §9). This is the most
 * important type in the system: it is the shape of an irreplaceable cultural
 * document. Design rules encoded here:
 *   • soft delete only — `deletedAt` marks removal; the bytes are NEVER destroyed.
 *   • `fileKey` is an opaque R2 UUID key, never an original filename (§11 Threat 5).
 *   • server-derived fields (`duration`, `fileSize`) are extracted, never trusted
 *     from the client.
 */

import type { Genre, Region, ContentLanguage, Instrument } from '@sma/constants';
import type { ObjectIdString, IsoDateTimeString, SoftDeletable } from './common';

/** Audio container/codec persisted in R2. */
export type AudioFormat = 'wav' | 'webm' | 'flac';

/** Moderation lifecycle of a recording document. */
export type RecordingStatus = 'draft' | 'review' | 'published' | 'archived';

/** Who may see a recording. Withdrawal of consent flips a record to `private` (§15). */
export type RecordingVisibility = 'public' | 'restricted' | 'private';

/** Content licence attached to a recording. */
export type RecordingLicense = 'CC-BY-4.0' | 'CC-BY-NC-4.0' | 'all-rights-reserved';

/** Status of the asynchronous AI enrichment pipeline for a recording (§10). */
export type AiStatus = 'pending' | 'processing' | 'complete' | 'failed';

/** Human-graded (or model-graded) recording quality. */
export type RecordingQuality = 'excellent' | 'good' | 'fair' | 'poor';

/** Trilingual title block. `somali` is the source of truth; the rest are aids. */
export interface RecordingTitle {
  readonly somali: string;
  readonly transliteration?: string;
  readonly english?: string;
}

/** A single pitch sample mapped onto the Somali pentatonic scale (§10 CREPE). */
export interface PitchPoint {
  readonly timeSec: number;
  readonly frequencyHz: number;
  /** CREPE confidence 0–1 for this frame, when available. */
  readonly confidence?: number;
  /** Nearest Somali scale degree: "do" | "re" | "mi" | "sol" | "la". */
  readonly noteLabel: string;
  /** Microtonality: deviation from equal temperament in cents. The research payload. */
  readonly centsDeviation: number;
}

/** AI-generated enrichment, populated asynchronously after upload (§10). */
export interface RecordingAi {
  readonly status: AiStatus;
  readonly transcriptSomali?: string;
  readonly transcriptEnglish?: string;
  readonly musicDescription?: string;
  readonly styleNotes?: string;
  readonly pitchData?: readonly PitchPoint[];
  /** Reference to the pgvector row holding the MERT embedding. */
  readonly embeddingId?: string;
  readonly genrePredicted?: Genre;
  readonly quality?: RecordingQuality;
  readonly processedAt?: IsoDateTimeString;
}

/** Field-session provenance. Consent recording is referenced, never inlined (§15). */
export interface RecordingSession {
  readonly id: string;
  readonly date?: IsoDateTimeString;
  readonly location?: string;
  /** Name of the person who made the recording. */
  readonly recorder?: string;
  /** R2 key of the verbal consent recording — an internal document (§15). */
  readonly consentFileKey?: string;
}

/** Denormalised artist reference stored on the recording for query performance. */
export interface RecordingArtistRef {
  readonly id: ObjectIdString;
  readonly name: string;
}

export interface Recording extends SoftDeletable {
  readonly _id: ObjectIdString;
  /** Human-readable business id, e.g. "2024-01-15-AAE-001". */
  readonly id: string;

  // ── File reference ──────────────────────────────────────────────────────────
  /** Opaque R2 object key (UUID) — NEVER the original filename (§11 Threat 5). */
  readonly fileKey: string;
  /** CDN URL for playback (short-lived signed URL is issued separately). */
  readonly fileUrl?: string;
  readonly waveformUrl?: string;
  /** Seconds — extracted server-side, never trusted from the client. */
  readonly duration: number;
  readonly fileSize: number;
  readonly format: AudioFormat;
  readonly sampleRate?: number;

  // ── Cultural metadata ───────────────────────────────────────────────────────
  readonly title: RecordingTitle;
  readonly artist: RecordingArtistRef;
  readonly poet?: { readonly name?: string; readonly notes?: string };
  readonly genre: Genre;
  readonly subgenre?: string;
  readonly occasion?: string;
  readonly instruments: readonly Instrument[];
  readonly language: ContentLanguage;
  readonly region?: Region;
  /** Decade string, e.g. "1970s". */
  readonly era?: string;

  // ── Provenance ──────────────────────────────────────────────────────────────
  readonly session?: RecordingSession;

  // ── AI enrichment ───────────────────────────────────────────────────────────
  readonly ai: RecordingAi;

  // ── Access control & moderation ─────────────────────────────────────────────
  readonly visibility: RecordingVisibility;
  readonly license: RecordingLicense;
  readonly status: RecordingStatus;
  readonly reviewedBy?: ObjectIdString;
  readonly reviewedAt?: IsoDateTimeString;

  // ── Engagement ──────────────────────────────────────────────────────────────
  readonly playCount: number;
  readonly saveCount: number;

  // ── Timestamps ──────────────────────────────────────────────────────────────
  readonly createdAt: IsoDateTimeString;
  readonly updatedAt: IsoDateTimeString;
}

/**
 * The shape returned to end-user clients: internal consent/session provenance and
 * moderation fields are stripped. What the mobile/web app renders on a recording.
 */
export type PublicRecording = Omit<
  Recording,
  'fileKey' | 'session' | 'reviewedBy' | 'reviewedAt' | 'deletedAt'
>;

/** A time-limited, signed URL to stream a recording's audio (§11 Threat 1). */
export interface SignedAudioUrl {
  readonly url: string;
  readonly expiresAt: IsoDateTimeString;
}
