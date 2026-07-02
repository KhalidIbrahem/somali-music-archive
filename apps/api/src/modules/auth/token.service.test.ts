import { describe, it, expect } from 'vitest';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from './token.service';
import { AppError } from '@/shared/errors/AppError';

describe('token.service', () => {
  it('round-trips an access token with its claims', () => {
    const token = signAccessToken('user-1', 'contributor');
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.role).toBe('contributor');
    expect(payload.type).toBe('access');
  });

  it('round-trips a refresh token', () => {
    const token = signRefreshToken('user-2');
    const payload = verifyRefreshToken(token);
    expect(payload.sub).toBe('user-2');
    expect(payload.type).toBe('refresh');
  });

  it('rejects an access token presented as a refresh token (separate secrets)', () => {
    const access = signAccessToken('user-3', 'listener');
    expect(() => verifyRefreshToken(access)).toThrow(AppError);
  });

  it('rejects a garbage token', () => {
    expect(() => verifyAccessToken('not-a-jwt')).toThrow(AppError);
  });
});
