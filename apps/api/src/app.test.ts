import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '@/app';

const app = createApp();

// A unique email per run so the process-wide in-memory repo does not collide
// across repeated local runs within the same process.
const email = `elder+${Date.now()}@example.com`;
const registration = {
  email,
  password: 'oudwood7',
  displayName: 'Ahmed Ali Egal',
  dateOfBirth: '1950-01-01',
  acceptedTerms: true,
};

describe('API integration', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { status: 'ok' } });
  });

  it('rejects registration with an invalid body (Zod validation)', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ email: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.fields)).toBe(true);
  });

  it('registers, then authorises GET /users/me with the returned token', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send(registration);
    expect(reg.status).toBe(201);
    const { accessToken, user } = reg.body.data;
    expect(user.email).toBe(email);

    const me = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(email);
  });

  it('rejects GET /users/me without a token', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('returns a 404 envelope for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('revokes the access token on logout (blacklist)', async () => {
    const uniqueEmail = `logout+${Date.now()}@example.com`;
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...registration, email: uniqueEmail });
    const token = reg.body.data.accessToken as string;

    // The token works before logout.
    const before = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);

    const out = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(out.status).toBe(200);

    // The same token is now blacklisted → rejected.
    const after = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('rotates refresh tokens and rejects a replayed one', async () => {
    const uniqueEmail = `rotate+${Date.now()}@example.com`;
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...registration, email: uniqueEmail });
    const refreshToken = reg.body.data.refreshToken as string;

    const rotated = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.refreshToken).not.toBe(refreshToken);

    const replay = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('rejects internal AI callbacks without the service key', async () => {
    const res = await request(app)
      .post(`/api/v1/internal/recordings/${'a'.repeat(24)}/ai`)
      .send({ kind: 'transcription' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('accepts the internal key but validates the payload and recording', async () => {
    // Correct key (vitest.setup sets AI_SERVICE_API_KEY=test), garbage payload → 400.
    const bad = await request(app)
      .post(`/api/v1/internal/recordings/${'a'.repeat(24)}/ai`)
      .set('x-internal-key', 'test')
      .send({ kind: 'nonsense' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');

    // Valid payload, unknown recording → 404 (auth + validation pipeline proven).
    const valid = await request(app)
      .post(`/api/v1/internal/recordings/${'a'.repeat(24)}/ai`)
      .set('x-internal-key', 'test')
      .send({
        kind: 'embedding',
        job_id: 'j1',
        embedding: new Array(768).fill(0.01),
        model_version: 'mert-v1-95m',
        dim: 768,
      });
    expect(valid.status).toBe(404);
    expect(valid.body.error.code).toBe('RECORDING_NOT_FOUND');
  });

  it('locks the account after 10 failed logins (brute-force protection)', async () => {
    const uniqueEmail = `lock+${Date.now()}@example.com`;
    await request(app)
      .post('/api/v1/auth/register')
      .send({ ...registration, email: uniqueEmail });

    let lastCode = '';
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: uniqueEmail, password: 'wrong-password9' });
      lastCode = res.body.error?.code;
    }
    expect(lastCode).toBe('AUTH_ACCOUNT_LOCKED');

    // Correct password is refused while locked.
    const correct = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail, password: registration.password });
    expect(correct.body.error.code).toBe('AUTH_ACCOUNT_LOCKED');
  });
});
