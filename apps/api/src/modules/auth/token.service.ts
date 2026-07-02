/**
 * JWT access/refresh token service (ARCHITECTURE.md §8 auth flow, §11).
 *
 * Access tokens are short-lived (15m); refresh tokens long-lived (30d) and are
 * additionally tracked/rotated in the database (that half lives in auth.service).
 * Access and refresh tokens are signed with SEPARATE secrets so a leaked access
 * secret cannot be used to mint refresh tokens.
 */

import jwt from 'jsonwebtoken';
import type { UserRole } from '@sma/types';
import { env } from '@/config/env';
import { unauthorized } from '@/shared/errors/AppError';

/** Claims carried by an access token. `sub` is the user id. */
export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
}

export function signAccessToken(userId: string, role: UserRole): string {
  const payload: AccessTokenPayload = { sub: userId, role, type: 'access' };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRY,
  } as jwt.SignOptions);
}

export function signRefreshToken(userId: string): string {
  const payload: RefreshTokenPayload = { sub: userId, type: 'refresh' };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRY,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
    if (typeof decoded === 'string' || decoded['type'] !== 'access') {
      throw unauthorized('AUTH_INVALID_TOKEN', 'Malformed access token');
    }
    return decoded as AccessTokenPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw unauthorized('AUTH_TOKEN_EXPIRED', 'Access token expired');
    }
    throw unauthorized('AUTH_INVALID_TOKEN', 'Invalid access token');
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET);
    if (typeof decoded === 'string' || decoded['type'] !== 'refresh') {
      throw unauthorized('AUTH_INVALID_TOKEN', 'Malformed refresh token');
    }
    return decoded as RefreshTokenPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw unauthorized('AUTH_TOKEN_EXPIRED', 'Refresh token expired');
    }
    throw unauthorized('AUTH_INVALID_TOKEN', 'Invalid refresh token');
  }
}
