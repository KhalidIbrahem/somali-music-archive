import { describe, it, expect, beforeEach } from 'vitest';
import { AppError } from '@/shared/errors/AppError';
import { InMemoryRecordingRepository } from '@/modules/recordings/recordings.repository';
import type { UserRecord } from '@/modules/auth/user.repository';
import { InMemoryCommentRepository } from './comments.repository';
import { createCommentsService, type CommentsService } from './comments.service';

const USER = 'user-1';
const users = {
  findById: async (id: string): Promise<UserRecord | null> =>
    id === USER ? ({ id, displayName: 'Ahmed Ali Egal' } as unknown as UserRecord) : null,
};

let repo: InMemoryCommentRepository;
let recordings: InMemoryRecordingRepository;
let service: CommentsService;
let publishedId: string; // the recording _id
let humanId: string;

async function publishRecording(): Promise<{ id: string; humanId: string }> {
  const draft = await recordings.createDraft({ fileKey: 'k', format: 'wav', sessionId: 's' });
  await recordings.complete(draft.recordingId, {
    title: { somali: 'Balwo' },
    singerName: 'Singer',
    genre: 'qaraami',
    instruments: ['oud'],
  });
  await recordings.updateModeration(draft.recordingId, { status: 'published' });
  const rec = await recordings.findById(draft.recordingId);
  return { id: draft.recordingId, humanId: rec?.id ?? '' };
}

beforeEach(async () => {
  repo = new InMemoryCommentRepository();
  recordings = new InMemoryRecordingRepository();
  service = createCommentsService({ repo, recordings, users });
  const published = await publishRecording();
  publishedId = published.id;
  humanId = published.humanId;
});

describe('createComment', () => {
  it('posts a comment with the author name snapshot', async () => {
    const comment = await service.createComment(USER, { recordingId: publishedId, body: 'Heylo!' });
    expect(comment.body).toBe('Heylo!');
    expect(comment.author.name).toBe('Ahmed Ali Egal');
    expect(comment.author.id).toBe(USER);
  });

  it('rejects commenting on an unpublished or unknown recording', async () => {
    const draft = await recordings.createDraft({ fileKey: 'k', format: 'wav', sessionId: 's' });
    await recordings.complete(draft.recordingId, {
      title: { somali: 'Draft' },
      singerName: 'X',
      genre: 'qaraami',
      instruments: ['oud'],
    }); // status 'review', not published
    await expect(
      service.createComment(USER, { recordingId: draft.recordingId, body: 'hi' }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      service.createComment(USER, { recordingId: 'f'.repeat(24), body: 'hi' }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('listComments', () => {
  it('lists a recording thread newest-first, addressable by either id form', async () => {
    await service.createComment(USER, { recordingId: publishedId, body: 'first' });
    await service.createComment(USER, { recordingId: publishedId, body: 'second' });

    const byId = await service.listComments({ recordingId: publishedId, page: 1, limit: 20 });
    expect(byId.total).toBe(2);
    expect(byId.data[0]?.body).toBe('second'); // newest first

    // The human id resolves to the same canonical recording.
    const byHuman = await service.listComments({ recordingId: humanId, page: 1, limit: 20 });
    expect(byHuman.total).toBe(2);
  });

  it('is empty (not an error) for an unknown recording', async () => {
    const res = await service.listComments({ recordingId: 'f'.repeat(24), page: 1, limit: 20 });
    expect(res.total).toBe(0);
    expect(res.data).toEqual([]);
  });
});

describe('deleteComment', () => {
  it('lets the author delete their own comment', async () => {
    const comment = await service.createComment(USER, { recordingId: publishedId, body: 'oops' });
    await service.deleteComment(USER, 'listener', comment.id);
    expect(
      (await service.listComments({ recordingId: publishedId, page: 1, limit: 20 })).total,
    ).toBe(0);
  });

  it('forbids a different non-admin from deleting', async () => {
    const comment = await service.createComment(USER, { recordingId: publishedId, body: 'x' });
    await expect(service.deleteComment('someone', 'listener', comment.id)).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it('lets an admin delete any comment', async () => {
    const comment = await service.createComment(USER, { recordingId: publishedId, body: 'x' });
    await expect(service.deleteComment('admin', 'admin', comment.id)).resolves.toBeUndefined();
  });

  it('404s an unknown comment', async () => {
    await expect(service.deleteComment(USER, 'listener', 'nope')).rejects.toBeInstanceOf(AppError);
  });
});
