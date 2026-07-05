/**
 * HTTP integration tests for the Research API (SESSION P3-07). Exercises the route
 * wiring the service unit tests don't cover: JWT gating on key management, API-key
 * auth on the dataset, and the full create-key → use-key → revoke flow through the
 * real middleware stack (per-key rate limiting is disabled under NODE_ENV=test).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '@/app';
import { recordingRepository } from '@/modules/recordings/recordings.repository';

const app = createApp();

/** Register a fresh user and return its access token. */
async function registerUser(): Promise<string> {
  const email = `researcher+${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app).post('/api/v1/auth/register').send({
    email,
    password: 'oudwood7',
    displayName: 'Researcher',
    dateOfBirth: '1980-01-01',
    acceptedTerms: true,
  });
  return reg.body.data.accessToken as string;
}

/** Create a research key and return its plaintext value + id. */
async function createKey(token: string): Promise<{ key: string; id: string }> {
  const res = await request(app)
    .post('/api/v1/research/keys')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Study', plan: 'academic' });
  expect(res.status).toBe(201);
  return { key: res.body.data.key as string, id: res.body.data.id as string };
}

beforeAll(async () => {
  // Seed one published recording so the dataset export has content.
  const { recordingId } = await recordingRepository.createDraft({
    fileKey: 'k',
    format: 'wav',
    sessionId: 's',
  });
  await recordingRepository.complete(recordingId, {
    title: { somali: 'Balwo Hobalka' },
    singerName: 'Ahmed Ali Egal',
    genre: 'qaraami',
    instruments: ['oud', 'voice'],
  });
  await recordingRepository.updateModeration(recordingId, { status: 'published' });
});

describe('research key management (JWT)', () => {
  it('requires a JWT to create a key', async () => {
    const res = await request(app).post('/api/v1/research/keys').send({ name: 'x' });
    expect(res.status).toBe(401);
  });

  it('creates a key (plaintext once) and lists it without the secret', async () => {
    const token = await registerUser();

    const created = await request(app)
      .post('/api/v1/research/keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'My study', plan: 'academic' });
    expect(created.status).toBe(201);
    expect(created.body.data.key).toMatch(/^sma_/);
    expect(created.body.data.rateLimit).toBe(1000);

    const list = await request(app)
      .get('/api/v1/research/keys')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).not.toHaveProperty('key');
    expect(list.body.data[0]).not.toHaveProperty('keyHash');
  });
});

describe('research dataset (API key)', () => {
  it('rejects the dataset without an API key', async () => {
    const res = await request(app).get('/api/v1/research/dataset');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('rejects an invalid API key', async () => {
    const res = await request(app)
      .get('/api/v1/research/dataset')
      .set('x-api-key', 'sma_not-a-real-key-000000000000');
    expect(res.status).toBe(401);
  });

  it('serves the projected corpus to a valid API key', async () => {
    const token = await registerUser();
    const { key } = await createKey(token);

    const res = await request(app).get('/api/v1/research/dataset').set('x-api-key', key);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
    const record = res.body.data.data[0];
    expect(record.artist).toBe('Ahmed Ali Egal');
    expect(record).toHaveProperty('durationSec');
    expect(record.ai).not.toHaveProperty('pitch'); // opt-in, off by default
  });

  it('accepts the key via Authorization: Bearer too', async () => {
    const token = await registerUser();
    const { key } = await createKey(token);
    const res = await request(app)
      .get('/api/v1/research/dataset')
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(200);
  });

  it('rejects a revoked key', async () => {
    const token = await registerUser();
    const { key, id } = await createKey(token);

    const del = await request(app)
      .delete(`/api/v1/research/keys/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const res = await request(app).get('/api/v1/research/dataset').set('x-api-key', key);
    expect(res.status).toBe(401);
  });
});
