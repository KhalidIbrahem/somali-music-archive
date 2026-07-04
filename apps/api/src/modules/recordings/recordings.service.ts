/**
 * Recordings service (ARCHITECTURE.md §8 upload flow, §12 RECORDINGS).
 *
 * Orchestrates the presigned-URL upload: issue a URL + create a draft → verify the
 * object landed in R2 → attach metadata + enqueue the AI pipeline. Built on injected
 * dependencies (storage, queue, repo) so it is unit-testable without R2 or Redis.
 */

import type { AudioFormat, Paginated, PublicRecording, SignedAudioUrl } from '@sma/types';
import type {
  ModerationQueryInput,
  RecordingModerationInput,
  UploadCompleteInput,
  UploadUrlRequestInput,
  RecordingQueryInput,
} from '@sma/validators';
import { badRequest, notFound } from '@/shared/errors/AppError';
import { asIso } from '@/shared/brand';
import { generateUploadUrl, generatePlaybackUrl, verifyExists } from '@/shared/storage/r2';
import { audioQueue, type AudioJobQueue } from '@/shared/queue/audioQueue';
import {
  embeddingRepository,
  type EmbeddingRepository,
} from '@/modules/internal/embeddings.repository';
import { searchIndex, toSearchDocument, type SearchIndex } from '@/modules/search/searchIndex';
import { recordingRepository, type RecordingRepository } from './recordings.repository';

const CONTENT_TYPE_FORMAT: Record<string, AudioFormat> = {
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
};

export interface PresignedUploadResult {
  uploadUrl: string;
  fileKey: string;
  recordingId: string;
  expiresAt: string;
}

export interface RecordingsServiceDeps {
  repo: RecordingRepository;
  storage: {
    generateUploadUrl(contentType: string): Promise<{
      uploadUrl: string;
      fileKey: string;
      expiresAt: string;
    }>;
    generatePlaybackUrl(fileKey: string): Promise<{ url: string; expiresAt: string }>;
    verifyExists(fileKey: string): Promise<boolean>;
  };
  queue: AudioJobQueue;
  embeddings: EmbeddingRepository;
  search: SearchIndex;
}

export function createRecordingsService(deps: RecordingsServiceDeps) {
  const { repo, storage, queue, embeddings, search } = deps;

  async function createUploadUrl(input: UploadUrlRequestInput): Promise<PresignedUploadResult> {
    const presigned = await storage.generateUploadUrl(input.contentType);
    const format = CONTENT_TYPE_FORMAT[input.contentType] ?? 'wav';
    const { recordingId } = await repo.createDraft({
      fileKey: presigned.fileKey,
      format,
      sessionId: input.sessionId,
    });
    return { ...presigned, recordingId };
  }

  async function completeUpload(
    input: UploadCompleteInput,
  ): Promise<{ recordingId: string; status: 'processing' }> {
    // The object must actually exist in R2 before we accept the completion (§8).
    const exists = await storage.verifyExists(input.fileKey);
    if (!exists) {
      throw badRequest('VALIDATION_ERROR', 'No uploaded object found for that fileKey');
    }
    if (input.metadata) {
      const updated = await repo.complete(input.recordingId, input.metadata);
      if (!updated) {
        throw notFound('RECORDING_NOT_FOUND', 'Draft recording not found');
      }
    }
    // Kick off the async AI pipeline (audio:process → transcribe/pitch/embed, §10).
    await queue.enqueueProcess({ recordingId: input.recordingId, fileKey: input.fileKey });
    return { recordingId: input.recordingId, status: 'processing' };
  }

  async function listRecordings(query: RecordingQueryInput): Promise<Paginated<PublicRecording>> {
    return repo.list(query);
  }

  async function getRecording(id: string): Promise<PublicRecording> {
    const recording = await repo.findById(id);
    if (!recording) throw notFound('RECORDING_NOT_FOUND', 'Recording not found');
    return recording;
  }

  /**
   * "Similar recordings" via MERT embeddings (SESSION P3-05, §12).
   *
   * Nearest neighbours in the vector space, hydrated to recordings and filtered
   * to the PUBLISHED archive — unreviewed material must never leak through a
   * similarity edge. Over-fetches 3× the limit before filtering so moderation
   * gaps don't under-fill the rail. Empty (not an error) while the recording's
   * embedding is still processing.
   */
  async function findSimilarRecordings(id: string, limit = 6): Promise<PublicRecording[]> {
    const recording = await repo.findById(id);
    if (!recording) throw notFound('RECORDING_NOT_FOUND', 'Recording not found');

    // Embeddings are keyed by the ObjectId the AI callback used, not the human id.
    const hits = await embeddings.findSimilar(recording._id, limit * 3);

    const similar: PublicRecording[] = [];
    for (const hit of hits) {
      if (similar.length >= limit) break;
      const candidate = await repo.findById(hit.recordingId);
      if (candidate && candidate.status === 'published' && candidate._id !== recording._id) {
        similar.push(candidate);
      }
    }
    return similar;
  }

  async function listForModeration(
    query: ModerationQueryInput,
  ): Promise<Paginated<PublicRecording>> {
    return repo.listForModeration(query);
  }

  /**
   * Change a recording's moderation status/visibility, and keep the search index
   * in step (SESSION P3-04): publishing adds it to the full-text index; any other
   * status (review/archived/draft) removes it, so search never surfaces a
   * recording that has left the public archive.
   */
  async function moderateRecording(
    id: string,
    patch: RecordingModerationInput,
  ): Promise<PublicRecording> {
    const updated = await repo.updateModeration(id, patch);
    if (!updated) throw notFound('RECORDING_NOT_FOUND', 'Recording not found');

    if (updated.status === 'published') {
      await search.index(toSearchDocument(updated));
    } else {
      await search.remove(String(updated._id));
    }
    return updated;
  }

  async function getPlaybackUrl(id: string): Promise<SignedAudioUrl> {
    const fileKey = await repo.getFileKey(id);
    if (!fileKey) throw notFound('RECORDING_NOT_FOUND', 'Recording not found');
    const signed = await storage.generatePlaybackUrl(fileKey);
    return { url: signed.url, expiresAt: asIso(signed.expiresAt) };
  }

  return {
    createUploadUrl,
    completeUpload,
    listRecordings,
    getRecording,
    getPlaybackUrl,
    findSimilarRecordings,
    listForModeration,
    moderateRecording,
  };
}

export type RecordingsService = ReturnType<typeof createRecordingsService>;

export const recordingsService: RecordingsService = createRecordingsService({
  repo: recordingRepository,
  storage: { generateUploadUrl, generatePlaybackUrl, verifyExists },
  queue: audioQueue,
  embeddings: embeddingRepository,
  search: searchIndex,
});
