/**
 * Internal AI-result ingestion (SESSION P3-03, ARCHITECTURE.md §10).
 *
 * Receives each pipeline stage's result from the Python AI service and persists
 * it: transcripts and pitch analytics merge into the recording's ai document;
 * embeddings go to the pgvector store, with the row id linked back onto the
 * recording. The snake_case→camelCase mapping from the Python wire format to
 * the domain types happens HERE, in one place — neither side leaks its casing
 * into the other.
 *
 * Injected repositories (ADR-0005) so every branch is unit-testable in-memory.
 */

import type { PitchPoint } from '@sma/types';
import type { AiResultInput, PitchResultInput, TranscriptionResultInput } from '@sma/validators';
import { notFound } from '@/shared/errors/AppError';
import {
  recordingRepository,
  type RecordingAiPatch,
  type RecordingRepository,
} from '@/modules/recordings/recordings.repository';
import { embeddingRepository, type EmbeddingRepository } from './embeddings.repository';

function transcriptionPatch(input: TranscriptionResultInput): RecordingAiPatch {
  return {
    transcriptSomali: input.somali_text,
    transcriptEnglish: input.english_text,
    isSinging: input.is_singing,
  };
}

function pitchPatch(input: PitchResultInput): RecordingAiPatch {
  const pitchData: PitchPoint[] = input.pitch_data.map((point) => ({
    timeSec: point.time_sec,
    frequencyHz: point.frequency_hz,
    confidence: point.confidence,
    noteLabel: point.note_label,
    centsDeviation: point.cents_deviation,
  }));
  return {
    pitchData,
    dominantNotes: input.dominant_notes,
    voicedFraction: input.voiced_fraction,
  };
}

export function createInternalService(deps: {
  recordings: RecordingRepository;
  embeddings: EmbeddingRepository;
}) {
  const { recordings, embeddings } = deps;

  /** Persist one stage's result onto the recording; 404s unknown recordings. */
  async function applyAiResult(recordingId: string, input: AiResultInput): Promise<void> {
    let patch: RecordingAiPatch;

    switch (input.kind) {
      case 'transcription':
        patch = transcriptionPatch(input);
        break;
      case 'pitch':
        patch = pitchPatch(input);
        break;
      case 'embedding': {
        // Store the vector first; only a successful store may be referenced.
        const { id } = await embeddings.upsert(recordingId, input.embedding, input.model_version);
        patch = { embeddingId: id };
        break;
      }
    }

    const updated = await recordings.updateAi(recordingId, patch);
    if (!updated) {
      throw notFound('RECORDING_NOT_FOUND', 'Recording not found for AI result');
    }
  }

  return { applyAiResult };
}

export type InternalService = ReturnType<typeof createInternalService>;

export const internalService: InternalService = createInternalService({
  recordings: recordingRepository,
  embeddings: embeddingRepository,
});
