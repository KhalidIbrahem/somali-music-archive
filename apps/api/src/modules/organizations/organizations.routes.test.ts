/**
 * HTTP integration tests for the institutional license system (SESSION P4-02).
 * Exercises the full stack: admin-only license issuance, a user claiming a seat,
 * the owner roster, seat limits, and leaving. An admin JWT is minted directly
 * (authenticate reads the role from the token, no DB user required).
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '@/app';
import { signAccessToken } from '@/modules/auth/token.service';

const app = createApp();
const adminToken = signAccessToken('admin-http-1', 'admin', true);

/** Register a fresh user; return its token and id. */
async function registerUser(): Promise<{ token: string; id: string }> {
  const email = `member+${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app).post('/api/v1/auth/register').send({
    email,
    password: 'oudwood7',
    displayName: 'Member',
    dateOfBirth: '1980-01-01',
    acceptedTerms: true,
  });
  return { token: reg.body.data.accessToken as string, id: reg.body.data.user.id as string };
}

/** Admin issues a license; returns the org id + key. */
async function issueLicense(seats: number): Promise<{ id: string; licenseKey: string }> {
  const res = await request(app)
    .post('/api/v1/organizations')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'University of X', seats });
  expect(res.status).toBe(201);
  return { id: res.body.data.id as string, licenseKey: res.body.data.licenseKey as string };
}

describe('license issuance', () => {
  it('is admin-only', async () => {
    const { token } = await registerUser();
    const res = await request(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Nope', seats: 1 });
    expect(res.status).toBe(403);
  });

  it('returns a shareable license key to the admin', async () => {
    const { licenseKey } = await issueLicense(3);
    expect(licenseKey).toMatch(/^SMA-INST-/);
  });
});

describe('membership', () => {
  it('lets a user claim a seat, appear in the roster, and leave', async () => {
    const { id, licenseKey } = await issueLicense(2);
    const member = await registerUser();

    const join = await request(app)
      .post('/api/v1/organizations/join')
      .set('Authorization', `Bearer ${member.token}`)
      .send({ licenseKey });
    expect(join.status).toBe(200);
    expect(join.body.data.organization.seatsUsed).toBe(1);

    const mine = await request(app)
      .get('/api/v1/organizations/mine')
      .set('Authorization', `Bearer ${member.token}`);
    expect(mine.body.data.role).toBe('member');

    // Owner (the issuing admin) sees the roster.
    const roster = await request(app)
      .get(`/api/v1/organizations/${id}/members`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(roster.status).toBe(200);
    expect(roster.body.data.map((m: { userId: string }) => m.userId)).toContain(member.id);

    const leave = await request(app)
      .post('/api/v1/organizations/leave')
      .set('Authorization', `Bearer ${member.token}`);
    expect(leave.status).toBe(200);

    const after = await request(app)
      .get('/api/v1/organizations/mine')
      .set('Authorization', `Bearer ${member.token}`);
    expect(after.body.data).toBeNull();
  });

  it('rejects an unknown license key', async () => {
    const { token } = await registerUser();
    const res = await request(app)
      .post('/api/v1/organizations/join')
      .set('Authorization', `Bearer ${token}`)
      .send({ licenseKey: 'SMA-INST-DOESNOTEXIST' });
    expect(res.status).toBe(404);
  });

  it('enforces the seat limit', async () => {
    const { licenseKey } = await issueLicense(1);
    const u1 = await registerUser();
    const u2 = await registerUser();

    const first = await request(app)
      .post('/api/v1/organizations/join')
      .set('Authorization', `Bearer ${u1.token}`)
      .send({ licenseKey });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/v1/organizations/join')
      .set('Authorization', `Bearer ${u2.token}`)
      .send({ licenseKey });
    expect(second.status).toBe(400);
  });
});
