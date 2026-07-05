/**
 * HTTP integration tests for collections (SESSION P4-05). Drives create → add →
 * get → remove → delete and the public/private read rule through the real stack.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '@/app';
import { recordingRepository } from '@/modules/recordings/recordings.repository';

const app = createApp();
let recordingId = '';

async function registerUser(): Promise<string> {
  const email = `curator+${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app).post('/api/v1/auth/register').send({
    email,
    password: 'oudwood7',
    displayName: 'Curator',
    dateOfBirth: '1980-01-01',
    acceptedTerms: true,
  });
  return reg.body.data.accessToken as string;
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

describe('collections', () => {
  it('runs the full create → add → get → remove → delete flow', async () => {
    const token = await registerUser();
    const auth = { Authorization: `Bearer ${token}` };

    const created = await request(app)
      .post('/api/v1/collections')
      .set(auth)
      .send({ name: 'Qaraami favourites', isPublic: false });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const added = await request(app)
      .post(`/api/v1/collections/${id}/items`)
      .set(auth)
      .send({ recordingId });
    expect(added.status).toBe(200);
    expect(added.body.data.itemCount).toBe(1);

    const detail = await request(app).get(`/api/v1/collections/${id}`).set(auth);
    expect(detail.status).toBe(200);
    expect(detail.body.data.items).toHaveLength(1);
    expect(detail.body.data.items[0].title.somali).toBe('Balwo');

    const mine = await request(app).get('/api/v1/collections/mine').set(auth);
    expect(mine.body.data.data.some((c: { id: string }) => c.id === id)).toBe(true);

    const removed = await request(app)
      .delete(`/api/v1/collections/${id}/items/${recordingId}`)
      .set(auth);
    expect(removed.status).toBe(200);

    const del = await request(app).delete(`/api/v1/collections/${id}`).set(auth);
    expect(del.status).toBe(200);
    const gone = await request(app).get(`/api/v1/collections/${id}`).set(auth);
    expect(gone.status).toBe(404);
  });

  it('enforces public/private read access', async () => {
    const ownerToken = await registerUser();
    const otherToken = await registerUser();

    const priv = await request(app)
      .post('/api/v1/collections')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Private', isPublic: false });
    const pub = await request(app)
      .post('/api/v1/collections')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Public', isPublic: true });

    const privRes = await request(app)
      .get(`/api/v1/collections/${priv.body.data.id}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(privRes.status).toBe(403);

    const pubRes = await request(app)
      .get(`/api/v1/collections/${pub.body.data.id}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(pubRes.status).toBe(200);
  });
});
