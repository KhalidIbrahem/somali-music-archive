import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RecordingCompleteMetadata } from '@sma/validators';
import { AppError } from '@/shared/errors/AppError';
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
  const service: RecordingsService = createRecordingsService({ repo, storage, queue });
  return { service, repo, storage, queue };
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
  it('excludes drafts and returns completed recordings', async () => {
    // A draft that is never completed must NOT appear in the archive listing.
    await ctx.service.createUploadUrl({
      filename: 'draft.wav',
      contentType: 'audio/wav',
      sessionId: 's0',
    });

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

    const page = await ctx.service.listRecordings({ page: 1, limit: 20 });
    expect(page.total).toBe(1);
    expect(page.data[0]?.title.somali).toBe('Balwo');
  });

  it('filters by genre', async () => {
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

    const match = await ctx.service.listRecordings({ page: 1, limit: 20, genre: 'qaraami' });
    expect(match.total).toBe(1);
    const miss = await ctx.service.listRecordings({ page: 1, limit: 20, genre: 'dhaanto' });
    expect(miss.total).toBe(0);
  });
});

describe('searchRecordings', () => {
  beforeEach(async () => {
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
  });

  it('matches free text against title and artist', async () => {
    expect((await ctx.service.searchRecordings({ page: 1, limit: 20, q: 'balwo' })).total).toBe(1);
    expect((await ctx.service.searchRecordings({ page: 1, limit: 20, q: 'ahmed' })).total).toBe(1);
    expect((await ctx.service.searchRecordings({ page: 1, limit: 20, q: 'nonsense' })).total).toBe(
      0,
    );
  });

  it('combines text with a genre facet', async () => {
    expect(
      (await ctx.service.searchRecordings({ page: 1, limit: 20, genre: 'qaraami' })).total,
    ).toBe(1);
    expect(
      (await ctx.service.searchRecordings({ page: 1, limit: 20, genre: 'dhaanto' })).total,
    ).toBe(0);
  });

  it('returns everything when the query is empty', async () => {
    expect((await ctx.service.searchRecordings({ page: 1, limit: 20 })).total).toBe(1);
  });
});

describe('getRecording', () => {
  it('throws RECORDING_NOT_FOUND for an unknown id', async () => {
    await expect(ctx.service.getRecording('f'.repeat(24))).rejects.toBeInstanceOf(AppError);
  });
});
