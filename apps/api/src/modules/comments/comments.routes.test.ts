/**
 * HTTP integration tests for comments (SESSION P4-05). Registers users for JWTs,
 * seeds a published recording directly into the shared repo, and drives the full
 * post → list → delete flow through the real middleware stack.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '@/app';
import { recordingRepository } from '@/modules/recordings/recordings.repository';

const app = createApp();
let recordingId = '';

async function registerUser(): Promise<{ token: string; id: string }> {
  const email = `commenter+${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app).post('/api/v1/auth/register').send({
    email,
    password: 'oudwood7',
    displayName: 'Commenter',
    dateOfBirth: '1980-01-01',
    acceptedTerms: true,
  });
  return { token: reg.body.data.accessToken as string, id: reg.body.data.user.id as string };
}

beforeAll(async () => {
  const draft = await recordingRepository.createDraft({
    fileKey: 'k',
    format: 'wav',
    sessionId: 's',
  });
  await recordingRepository.complete(draft.recordingId, {
    title: { somali: 'Balwo' },
    singerName: 'Ahmed Ali Egal',
    genre: 'qaraami',
    instruments: ['oud'],
  });
  await recordingRepository.updateModeration(draft.recordingId, { status: 'published' });
  recordingId = draft.recordingId;
});

describe('comments', () => {
  it('requires auth', async () => {
    const res = await request(app).get(`/api/v1/comments?recordingId=${recordingId}`);
    expect(res.status).toBe(401);
  });

  it('posts, lists, and lets the author delete a comment', async () => {
    const author = await registerUser();

    const post = await request(app)
      .post('/api/v1/comments')
      .set('Authorization', `Bearer ${author.token}`)
      .send({ recordingId, body: 'Waa hees qurux badan!' });
    expect(post.status).toBe(201);
    expect(post.body.data.author.name).toBe('Commenter');
    const commentId = post.body.data.id as string;

    const list = await request(app)
      .get(`/api/v1/comments?recordingId=${recordingId}`)
      .set('Authorization', `Bearer ${author.token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.data.some((c: { id: string }) => c.id === commentId)).toBe(true);

    const del = await request(app)
      .delete(`/api/v1/comments/${commentId}`)
      .set('Authorization', `Bearer ${author.token}`);
    expect(del.status).toBe(200);
  });

  it('forbids deleting another user’s comment', async () => {
    const author = await registerUser();
    const other = await registerUser();

    const post = await request(app)
      .post('/api/v1/comments')
      .set('Authorization', `Bearer ${author.token}`)
      .send({ recordingId, body: 'mine' });
    const commentId = post.body.data.id as string;

    const del = await request(app)
      .delete(`/api/v1/comments/${commentId}`)
      .set('Authorization', `Bearer ${other.token}`);
    expect(del.status).toBe(403);
  });

  it('rejects a comment on an unknown recording', async () => {
    const author = await registerUser();
    const res = await request(app)
      .post('/api/v1/comments')
      .set('Authorization', `Bearer ${author.token}`)
      .send({ recordingId: 'f'.repeat(24), body: 'hi' });
    expect(res.status).toBe(404);
  });
});
