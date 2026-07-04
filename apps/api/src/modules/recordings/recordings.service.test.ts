import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RecordingCompleteMetadata } from '@sma/validators';
import { AppError } from '@/shared/errors/AppError';
import { InMemoryEmbeddingRepository } from '@/modules/internal/embeddings.repository';
import { InMemorySearchIndex } from '@/modules/search/searchIndex';
import { InMemoryRecordingRepository } from './recordings.repository';
import { createRecordingsService, type RecordingsService } from './recordings.service';

const metadata: RecordingCompleteMetadata = {
  title: { somali: 'Balwo' },
  singerName: 'Ahmed Ali Egal',
  genre: 'qaraami',
  instruments: ['oud', 'voice'],
};

function makeService() {
  const repo = new InMemoryRecordingRepository();
  const storage = {
    generateUploadUrl: vi.fn(async () => ({
      uploadUrl: 'https://r2.example.com/put',
      fileKey: 'recordings/ab/uuid.wav',
      expiresAt: '2026-01-01T00:00:00Z',
    })),
    generatePlaybackUrl: vi.fn(async () => ({
      url: 'https://cdn.example.com/get',
      expiresAt: '2026-01-01T01:00:00Z',
    })),
    verifyExists: vi.fn(async () => true),
  };
  const queue = { enqueueProcess: vi.fn(async () => {}) };
  const embeddings = new InMemoryEmbeddingRepository();
  const search = new InMemorySearchIndex();
  const service: RecordingsService = createRecordingsService({
    repo,
    storage,
    queue,
    embeddings,
    search,
  });
  return { service, repo, storage, queue, embeddings, search };
}

let ctx: ReturnType<typeof makeService>;
beforeEach(() => {
  ctx = makeService();
});

describe('createUploadUrl', () => {
  it('returns a presigned URL and a draft recordingId', async () => {
    const result = await ctx.service.createUploadUrl({
      filename: 'take.wav',
      contentType: 'audio/wav',
      sessionId: 's1',
    });
    expect(result.uploadUrl).toBe('https://r2.example.com/put');
    expect(result.fileKey).toBe('recordings/ab/uuid.wav');
    expect(result.recordingId).toMatch(/^[a-f0-9]{24}$/);
  });
});

describe('completeUpload', () => {
  async function draft(): Promise<{ recordingId: string; fileKey: string }> {
    const r = await ctx.service.createUploadUrl({
      filename: 'take.wav',
      contentType: 'audio/wav',
      sessionId: 's1',
    });
    return { recordingId: r.recordingId, fileKey: r.fileKey };
  }

  it('verifies the object, attaches metadata, and enqueues processing', async () => {
    const { recordingId, fileKey } = await draft();

    const result = await ctx.service.completeUpload({ recordingId, fileKey, metadata });

    expect(result).toEqual({ recordingId, status: 'processing' });
    expect(ctx.queue.enqueueProcess).toHaveBeenCalledWith({ recordingId, fileKey });

    const recording = await ctx.service.getRecording(recordingId);
    expect(recording.title.somali).toBe('Balwo');
    expect(recording.artist.name).toBe('Ahmed Ali Egal');
    expect(recording.ai.status).toBe('processing');
  });

  it('rejects completion when the object is missing from R2', async () => {
    const { recordingId, fileKey } = await draft();
    ctx.storage.verifyExists.mockResolvedValueOnce(false);

    await expect(
      ctx.service.completeUpload({ recordingId, fileKey, metadata }),
    ).rejects.toBeInstanceOf(AppError);
    expect(ctx.queue.enqueueProcess).not.toHaveBeenCalled();
  });
});

describe('listRecordings', () => {
  async function publishOne(): Promise<void> {
    const done = await ctx.service.createUploadUrl({
      filename: 'take.wav',
      contentType: 'audio/wav',
      sessionId: 's1',
    });
    await ctx.service.completeUpload({
      recordingId: done.recordingId,
      fileKey: done.fileKey,
      metadata,
    });
    await ctx.service.moderateRecording(done.recordingId, { status: 'published' });
  }

  it('lists only published recordings (not drafts or unreviewed)', async () => {
    // A draft that is never completed, and a completed-but-unpublished (review)
    // recording, must NOT appear in the public archive listing.
    await ctx.service.createUploadUrl({
      filename: 'draft.wav',
      contentType: 'audio/wav',
      sessionId: 's0',
    });
    await publishOne();

    const page = await ctx.service.listRecordings({ page: 1, limit: 20 });
    expect(page.total).toBe(1);
    expect(page.data[0]?.title.somali).toBe('Balwo');
  });

  it('filters by genre', async () => {
    await publishOne();
    const match = await ctx.service.listRecordings({ page: 1, limit: 20, genre: 'qaraami' });
    expect(match.total).toBe(1);
    const miss = await ctx.service.listRecordings({ page: 1, limit: 20, genre: 'dhaanto' });
    expect(miss.total).toBe(0);
  });
});

describe('getRecording', () => {
  it('throws RECORDING_NOT_FOUND for an unknown id', async () => {
    await expect(ctx.service.getRecording('f'.repeat(24))).rejects.toBeInstanceOf(AppError);
  });
});

describe('findSimilarRecordings (vector similarity)', () => {
  /** Create a recording, optionally publish it, optionally attach an embedding. */
  async function seed(
    title: string,
    embedding: number[] | null,
    published = true,
  ): Promise<string> {
    const draft = await ctx.service.createUploadUrl({
      filename: 'take.wav',
      contentType: 'audio/wav',
      sessionId: title,
    });
    await ctx.service.completeUpload({
      recordingId: draft.recordingId,
      fileKey: draft.fileKey,
      metadata: { ...metadata, title: { somali: title } },
    });
    if (published) {
      await ctx.service.moderateRecording(draft.recordingId, { status: 'published' });
    }
    if (embedding) {
      await ctx.embeddings.upsert(draft.recordingId, embedding, 'mert-v1-95m');
    }
    return draft.recordingId;
  }

  it('returns published neighbours ordered by cosine similarity', async () => {
    const queryId = await seed('Query', [1, 0, 0]);
    await seed('Near', [0.9, 0.1, 0]); // most similar
    await seed('Mid', [0.6, 0.8, 0]);
    await seed('Far', [0, 1, 0]); // orthogonal

    const similar = await ctx.service.findSimilarRecordings(queryId);
    expect(similar.map((r) => r.title.somali)).toEqual(['Near', 'Mid', 'Far']);
  });

  it('never leaks unpublished recordings through a similarity edge', async () => {
    const queryId = await seed('Query', [1, 0, 0]);
    await seed('Hidden', [1, 0, 0], false); // identical vector but NOT published
    await seed('Visible', [0.5, 0.5, 0]);

    const similar = await ctx.service.findSimilarRecordings(queryId);
    expect(similar.map((r) => r.title.somali)).toEqual(['Visible']);
  });

  it('is empty (not an error) while the embedding is still processing', async () => {
    const queryId = await seed('NoEmbedding', null);
    await seed('Other', [1, 0, 0]);
    expect(await ctx.service.findSimilarRecordings(queryId)).toEqual([]);
  });

  it('respects the result limit', async () => {
    const queryId = await seed('Query', [1, 0, 0]);
    for (let i = 0; i < 5; i += 1) {
      await seed(`N${i}`, [1, i / 100, 0]);
    }
    expect(await ctx.service.findSimilarRecordings(queryId, 2)).toHaveLength(2);
  });

  it('404s an unknown recording', async () => {
    await expect(ctx.service.findSimilarRecordings('f'.repeat(24))).rejects.toBeInstanceOf(
      AppError,
    );
  });
});

describe('moderation (admin)', () => {
  async function completed(): Promise<string> {
    const done = await ctx.service.createUploadUrl({
      filename: 'take.wav',
      contentType: 'audio/wav',
      sessionId: 's1',
    });
    await ctx.service.completeUpload({
      recordingId: done.recordingId,
      fileKey: done.fileKey,
      metadata,
    });
    return done.recordingId;
  }

  it('lists recordings pending review and publishes one', async () => {
    const recordingId = await completed();

    // A completed upload sits in "review" — visible to moderation but not the archive.
    const review = await ctx.service.listForModeration({ page: 1, limit: 20, status: 'review' });
    expect(review.total).toBe(1);
    expect((await ctx.service.listRecordings({ page: 1, limit: 20 })).total).toBe(0);

    const updated = await ctx.service.moderateRecording(recordingId, {
      status: 'published',
      visibility: 'public',
    });
    expect(updated.status).toBe('published');
    expect(updated.visibility).toBe('public');

    // Now it appears in the public archive listing.
    expect((await ctx.service.listRecordings({ page: 1, limit: 20 })).total).toBe(1);
  });

  it('adds a recording to the search index on publish and removes it on archive', async () => {
    const recordingId = await completed();

    // In "review" it is not yet searchable.
    expect(await ctx.search.count()).toBe(0);

    await ctx.service.moderateRecording(recordingId, { status: 'published' });
    expect((await ctx.search.search({ page: 1, limit: 20, q: 'balwo' })).total).toBe(1);

    // Archiving pulls it back out of the index.
    await ctx.service.moderateRecording(recordingId, { status: 'archived' });
    expect(await ctx.search.count()).toBe(0);
  });

  it('rejects moderating an unknown recording', async () => {
    await expect(
      ctx.service.moderateRecording('f'.repeat(24), { status: 'archived' }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
