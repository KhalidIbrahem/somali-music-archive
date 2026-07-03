/**
 * JWT access/refresh token service (ARCHITECTURE.md §8 auth flow, §11).
 *
 * Access tokens are short-lived (15m) and carry a `jti` so a specific token can be
 * revoked via the blacklist on logout, plus an `emailVerified` claim so gated
 * endpoints can check verification without a database round-trip. Refresh tokens
 * are long-lived (30d), tracked/rotated in the store (auth.service). Access and
 * refresh tokens are signed with SEPARATE secrets so a leaked access secret cannot
 * mint refresh tokens.
 */

import jwt from 'jsonwebtoken';
import type { UserRole } from '@sma/types';
import { env } from '@/config/env';
import { unauthorized } from '@/shared/errors/AppError';
import { randomUUID } from '@/shared/crypto';

/** Claims carried by an access token. `sub` is the user id. */
export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  emailVerified: boolean;
  /** Unique token id — used to revoke this exact token (blacklist). */
  jti: string;
  type: 'access';
  /** Standard JWT claims, populated by verification. */
  exp: number;
  iat: number;
}

export interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
}

/** Metadata needed to blacklist a token: its id and remaining lifetime. */
export interface AccessTokenMeta {
  jti: string;
  /** Expiry as a UNIX timestamp in seconds. */
  exp: number;
}

export function signAccessToken(userId: string, role: UserRole, emailVerified: boolean): string {
  const payload = { sub: userId, role, emailVerified, jti: randomUUID(), type: 'access' as const };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRY,
  } as jwt.SignOptions);
}

export function signRefreshToken(userId: string): string {
  // A per-token `jti` makes every refresh token a UNIQUE string even when two are
  // issued in the same second — essential for rotation and replay detection, which
  // key off the token's hash. Without it, re-signing the same {sub,type} payload
  // within one second yields an identical JWT.
  const payload = { sub: userId, jti: randomUUID(), type: 'refresh' as const };
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
