/**
 * AI-result callback schemas (SESSION P3-03, ARCHITECTURE.md §10).
 *
 * The Python AI service POSTs each stage's result to the Node API's internal
 * endpoint with a `kind` discriminator. These schemas validate that internal
 * wire contract — snake_case keys exactly as Python emits them (the mapping to
 * camelCase domain fields happens in the internal service, not here). Zod on
 * every input applies to internal callers too (CLAUDE.md hard rule): a bug in
 * the AI service must not be able to write garbage into the archive.
 */

import { z } from 'zod';

/** MERT-v1-95M output size — must match the pgvector column vector(768) (§9). */
export const MERT_EMBEDDING_DIM = 768;

const transcriptSegmentSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  text: z.string(),
  confidence: z.number().min(0).max(1),
});

export const transcriptionResultSchema = z.object({
  kind: z.literal('transcription'),
  job_id: z.string(),
  somali_text: z.string(),
  english_text: z.string(),
  segments: z.array(transcriptSegmentSchema),
  detected_language: z.string(),
  is_singing: z.boolean(),
  duration_sec: z.number().min(0),
});

const pitchPointSchema = z.object({
  time_sec: z.number().min(0),
  frequency_hz: z.number().positive(),
  confidence: z.number().min(0).max(1),
  note_label: z.string(),
  cents_deviation: z.number(),
});

const noteStatsSchema = z.object({
  count: z.number().min(0),
  share: z.number().min(0).max(1),
  mean_cents: z.number(),
});

export const pitchResultSchema = z.object({
  kind: z.literal('pitch'),
  job_id: z.string(),
  pitch_data: z.array(pitchPointSchema),
  dominant_notes: z.array(z.string()),
  note_statistics: z.record(noteStatsSchema),
  voiced_fraction: z.number().min(0).max(1),
  duration_sec: z.number().min(0),
});

export const embeddingResultSchema = z.object({
  kind: z.literal('embedding'),
  job_id: z.string(),
  // finite() rejects NaN/inf — a corrupt vector must never reach pgvector.
  embedding: z.array(z.number().finite()).length(MERT_EMBEDDING_DIM),
  model_version: z.string().min(1),
  dim: z.literal(MERT_EMBEDDING_DIM),
});

/** One schema for the whole internal endpoint, discriminated by stage. */
export const aiResultSchema = z.discriminatedUnion('kind', [
  transcriptionResultSchema,
  pitchResultSchema,
  embeddingResultSchema,
]);

export type TranscriptionResultInput = z.infer<typeof transcriptionResultSchema>;
export type PitchResultInput = z.infer<typeof pitchResultSchema>;
export type EmbeddingResultInput = z.infer<typeof embeddingResultSchema>;
export type AiResultInput = z.infer<typeof aiResultSchema>;
