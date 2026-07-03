/**
 * Recording input schemas (ARCHITECTURE.md §8 upload flow, §12 RECORDINGS).
 *
 * The upload flow NEVER accepts file bytes through the API (CLAUDE.md hard rule):
 * the client asks for a presigned URL, uploads directly to R2, then notifies the
 * API. These schemas validate the metadata around that flow, not the audio itself.
 */

import { z } from 'zod';
import {
  genreSchema,
  regionSchema,
  instrumentSchema,
  contentLanguageSchema,
  objectIdSchema,
  paginationQuerySchema,
} from './common';

/** MIME types permitted for upload (§8, §11 Threat 5). Enforced again at R2. */
export const ALLOWED_AUDIO_CONTENT_TYPES = ['audio/wav', 'audio/webm', 'audio/flac'] as const;
export const audioContentTypeSchema = z.enum(ALLOWED_AUDIO_CONTENT_TYPES);

/** Maximum accepted upload size, mirrored at the CDN edge (§11 Threat 5). */
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

/** Step 1 — request a presigned upload URL. Original filename is advisory only;
 * the server assigns a UUID key and never trusts the client's name (§11 Threat 5). */
export const uploadUrlRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: audioContentTypeSchema,
  sessionId: z.string().min(1),
  /** Optional client-reported size for a fast pre-check; authoritative size is R2's. */
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES).optional(),
});

/**
 * Metadata captured on the record screen and sent with upload-complete. Uses a
 * free-text `singerName` (the artist collection + `artistId` resolution arrive with
 * the artist system); genre/region/instruments are constrained to the canonical lists.
 */
export const recordingCompleteMetadataSchema = z.object({
  title: z.object({ somali: z.string().trim().min(1, 'Somali title is required').max(300) }),
  singerName: z.string().trim().min(1).max(200),
  poetName: z.string().trim().max(200).optional(),
  genre: genreSchema,
  occasion: z.string().trim().max(120).optional(),
  region: regionSchema.optional(),
  era: z
    .string()
    .regex(/^\d{4}s$/, 'Use a decade like "1970s"')
    .optional(),
  instruments: z.array(instrumentSchema).min(1, 'Select at least one instrument'),
  fieldNotes: z.string().trim().max(4000).optional(),
});

/** Step 4 — notify the API the direct-to-R2 upload finished, with the take's metadata. */
export const uploadCompleteSchema = z.object({
  recordingId: objectIdSchema,
  fileKey: z.string().min(1),
  metadata: recordingCompleteMetadataSchema.optional(),
});

/** Trilingual title; the Somali title is the source of truth and required. */
export const recordingTitleSchema = z.object({
  somali: z.string().trim().min(1, 'Somali title is required').max(300),
  transliteration: z.string().trim().max(300).optional(),
  english: z.string().trim().max(300).optional(),
});

/**
 * Cultural metadata attached to a recording. Used to create a draft and (as a
 * partial) to PATCH an existing recording. Genre/region/instruments/language are
 * constrained to the canonical constant lists.
 */
export const recordingMetadataSchema = z.object({
  title: recordingTitleSchema,
  artistId: objectIdSchema,
  genre: genreSchema,
  subgenre: z.string().trim().max(120).optional(),
  occasion: z.string().trim().max(120).optional(),
  instruments: z.array(instrumentSchema).min(1, 'Select at least one instrument'),
  language: contentLanguageSchema,
  region: regionSchema.optional(),
  era: z
    .string()
    .regex(/^\d{4}s$/, 'Use a decade like "1970s"')
    .optional(),
});

/** PATCH payload — every field optional, but at least one must be present. */
export const recordingUpdateSchema = recordingMetadataSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

/** GET /recordings list filters + pagination (§12). */
export const recordingQuerySchema = paginationQuerySchema.extend({
  genre: genreSchema.optional(),
  region: regionSchema.optional(),
  era: z
    .string()
    .regex(/^\d{4}s$/)
    .optional(),
  artistId: objectIdSchema.optional(),
});

/** GET /search — free-text query `q` plus the same facet filters (§12). */
export const searchQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  genre: genreSchema.optional(),
  region: regionSchema.optional(),
  era: z
    .string()
    .regex(/^\d{4}s$/)
    .optional(),
});

// ── Admin moderation (ARCHITECTURE.md §12 PATCH /recordings/:id, admin only) ──
export const recordingStatusEnum = z.enum(['draft', 'review', 'published', 'archived']);
export const recordingVisibilityEnum = z.enum(['public', 'restricted', 'private']);

/** Admin PATCH: change a recording's moderation status and/or visibility. */
export const recordingModerationSchema = z
  .object({
    status: recordingStatusEnum.optional(),
    visibility: recordingVisibilityEnum.optional(),
  })
  .refine((d) => d.status !== undefined || d.visibility !== undefined, {
    message: 'Provide a status or visibility to change',
  });

/** Admin moderation queue query (optionally filtered by status). */
export const moderationQuerySchema = paginationQuerySchema.extend({
  status: recordingStatusEnum.optional(),
});

export type UploadUrlRequestInput = z.infer<typeof uploadUrlRequestSchema>;
export type UploadCompleteInput = z.infer<typeof uploadCompleteSchema>;
export type RecordingCompleteMetadata = z.infer<typeof recordingCompleteMetadataSchema>;
export type RecordingMetadataInput = z.infer<typeof recordingMetadataSchema>;
export type RecordingUpdateInput = z.infer<typeof recordingUpdateSchema>;
export type RecordingQueryInput = z.output<typeof recordingQuerySchema>;
export type SearchQueryInput = z.output<typeof searchQuerySchema>;
export type RecordingModerationInput = z.infer<typeof recordingModerationSchema>;
export type ModerationQueryInput = z.output<typeof moderationQuerySchema>;
