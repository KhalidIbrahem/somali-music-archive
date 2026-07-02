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
});
