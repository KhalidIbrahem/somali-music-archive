/**
 * Harvard dataset → platform mapping (SESSION "harvard ingest", P5-07 prep).
 *
 * Pure translation layer between the Colab pipeline's output
 * (`somali_music_dataset_v1.json` + `pitch_data/track_XXXX_pitch.json`, produced by
 * apps/ai-service/notebooks/harvard_pipeline.ipynb) and the platform's canonical
 * shapes (RecordingCompleteMetadata + the AI patch). Every input crosses a Zod
 * schema (CONVENTIONS.md hard rule), and the mapping never invents cultural facts:
 * unverified genre falls back to 'other', unknown artists to an explicit
 * "Unknown (Harvard AWM)", and the provenance trail lands in fieldNotes so a
 * reviewer can always see where a value came from.
 */

import { z } from 'zod';
import type { PitchPoint } from '@sma/types';
import { GENRES, type Genre } from '@sma/constants';
import type { RecordingCompleteMetadata } from '@sma/validators';
import type { RecordingAiPatch } from './recordings.repository';

/** One record of somali_music_dataset_v1.json (notebook Step 8). */
export const harvardRecordSchema = z
  .object({
    track_id: z.number().int().nonnegative(),
    filename: z.string().min(1),
    title: z.string().nullable(),
    artists: z.string().nullable(),
    duration_sec: z.number().nullable(),
    quality_score: z.number().min(0).max(100),
    transcript_somali: z.string().nullable(),
    transcript_english: z.string().nullable(),
    is_singing: z.boolean().nullable(),
    transcript_confidence: z.number().nullable(),
    dominant_notes: z.array(z.string()).nullable(),
    voiced_fraction: z.number().nullable(),
    pitch_data_file: z.string().nullable(),
    genre_predicted: z.string().nullable(),
    era_estimated: z.string().nullable(),
    metadata_source: z.string().optional(),
  })
  .passthrough(); // the notebook may grow fields; unknown keys are not an error

export type HarvardRecord = z.infer<typeof harvardRecordSchema>;

/** The pitch analysis JSON written by notebook Step 7 (subset we ingest). */
export const harvardPitchFileSchema = z
  .object({
    voiced_fraction: z.number().optional(),
    dominant_notes: z.array(z.string()).optional(),
    points: z.array(
      z.object({
        time_sec: z.number(),
        frequency_hz: z.number(),
        confidence: z.number(),
        note_label: z.string(),
        cents_deviation: z.number(),
      }),
    ),
  })
  .passthrough();

export type HarvardPitchFile = z.infer<typeof harvardPitchFileSchema>;

const ERA_RE = /^\d{4}s$/;

function isGenre(value: string): value is Genre {
  return (GENRES as readonly string[]).includes(value);
}

/** Stable R2 object key for a Harvard track (UUID-free by design: the track id IS
 * the archival identity, and re-runs must map to the same object). Audio is
 * uploaded to this key directly (rclone/S3 CLI) — never through Node (hard rule). */
export function harvardFileKey(trackId: number): string {
  return `recordings/harvard/track_${String(trackId).padStart(4, '0')}.wav`;
}

/**
 * Map a dataset record to the platform's completion metadata.
 *
 * Fallbacks are explicit and documented in fieldNotes rather than silent:
 * no verified genre → 'other'; no artist → "Unknown (Harvard AWM)"; instruments
 * are NOT guessed per-track (the corpus is oud-and-voice heavy, but asserting
 * that per recording without listening would be fabrication) → ['other'].
 */
export function toCompleteMetadata(record: HarvardRecord): RecordingCompleteMetadata {
  const genre: Genre =
    record.genre_predicted && isGenre(record.genre_predicted) ? record.genre_predicted : 'other';

  const notes = [
    'Harvard Archive of World Music digitisation (QaraamiGen pipeline).',
    `Source track_id=${record.track_id}; metadata_source=${record.metadata_source ?? 'filename'}.`,
    `quality_score=${record.quality_score}.`,
    'Genre, era, and instruments pending Somali music scholar review.',
  ];

  return {
    title: { somali: record.title?.trim() || record.filename.replace(/\.wav$/i, '') },
    singerName: record.artists?.trim() || 'Unknown (Harvard AWM)',
    genre,
    instruments: ['other'],
    ...(record.era_estimated && ERA_RE.test(record.era_estimated)
      ? { era: record.era_estimated }
      : {}),
    fieldNotes: notes.join(' '),
  };
}

/** Convert notebook pitch points (snake_case) to platform PitchPoint[] (camelCase). */
export function toPitchPoints(pitch: HarvardPitchFile): PitchPoint[] {
  return pitch.points.map((p) => ({
    timeSec: p.time_sec,
    frequencyHz: p.frequency_hz,
    confidence: p.confidence,
    noteLabel: p.note_label,
    centsDeviation: p.cents_deviation,
  }));
}

/**
 * Map the record (plus its optional pitch file) onto the AI patch the pipeline
 * callback would normally deliver. Null fields are omitted, not written as null —
 * the patch semantics merge stages without clobbering (recordings.repository).
 */
export function toAiPatch(
  record: HarvardRecord,
  pitch?: HarvardPitchFile,
  options: { includePitchPoints?: boolean } = {},
): RecordingAiPatch {
  return {
    ...(record.transcript_somali ? { transcriptSomali: record.transcript_somali } : {}),
    ...(record.transcript_english ? { transcriptEnglish: record.transcript_english } : {}),
    ...(record.is_singing !== null ? { isSinging: record.is_singing } : {}),
    ...(record.dominant_notes?.length ? { dominantNotes: record.dominant_notes } : {}),
    ...(record.voiced_fraction !== null ? { voicedFraction: record.voiced_fraction } : {}),
    ...(pitch && options.includePitchPoints ? { pitchData: toPitchPoints(pitch) } : {}),
    ...(pitch && !options.includePitchPoints && pitch.dominant_notes?.length
      ? { dominantNotes: pitch.dominant_notes }
      : {}),
  };
}
