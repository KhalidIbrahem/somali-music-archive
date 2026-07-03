import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import { AppError } from '@/shared/errors/AppError';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from './token.service';

describe('token.service', () => {
  it('round-trips an access token with its claims (role, emailVerified, jti)', () => {
    const token = signAccessToken('user-1', 'contributor', true);
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.role).toBe('contributor');
    expect(payload.emailVerified).toBe(true);
    expect(payload.type).toBe('access');
    expect(payload.jti).toBeTruthy();
  });

  it('gives each access token a unique jti (so they can be revoked individually)', () => {
    const a = verifyAccessToken(signAccessToken('user-1', 'listener', false));
    const b = verifyAccessToken(signAccessToken('user-1', 'listener', false));
    expect(a.jti).not.toBe(b.jti);
  });

  it('round-trips a refresh token', () => {
    const payload = verifyRefreshToken(signRefreshToken('user-2'));
    expect(payload.sub).toBe('user-2');
    expect(payload.type).toBe('refresh');
  });

  it('rejects an access token presented as a refresh token (separate secrets)', () => {
    const access = signAccessToken('user-3', 'listener', false);
    expect(() => verifyRefreshToken(access)).toThrow(AppError);
  });

  it('rejects a garbage token', () => {
    expect(() => verifyAccessToken('not-a-jwt')).toThrow(AppError);
  });

  it('rejects an expired access token with AUTH_TOKEN_EXPIRED', () => {
    const expired = jwt.sign(
      { sub: 'user-9', role: 'listener', emailVerified: true, jti: 'j', type: 'access' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: -10 },
    );
    expect.assertions(2);
    try {
      verifyAccessToken(expired);
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('AUTH_TOKEN_EXPIRED');
    }
  });
});
