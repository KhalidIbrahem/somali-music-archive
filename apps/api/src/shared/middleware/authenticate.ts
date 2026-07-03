/**
 * Authentication middleware (ARCHITECTURE.md §8, §11).
 *
 * For each request it: extracts the `Authorization: Bearer <jwt>`, verifies the
 * access token's signature + expiry, rejects it if its `jti` is on the blacklist
 * (revoked via logout), and attaches the principal to `req.user`.
 */

import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '@/shared/errors/AppError';
import { verifyAccessToken } from '@/modules/auth/token.service';
import { tokenBlacklist } from '@/shared/auth/tokenBlacklist';

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(unauthorized('AUTH_INVALID_TOKEN', 'Missing bearer token'));
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = verifyAccessToken(token);
    if (await tokenBlacklist.has(payload.jti)) {
      next(unauthorized('AUTH_INVALID_TOKEN', 'Token has been revoked'));
      return;
    }
    req.user = {
      id: payload.sub,
      role: payload.role,
      emailVerified: payload.emailVerified,
      jti: payload.jti,
      exp: payload.exp,
    };
    next();
  } catch (err) {
    next(err);
  }
}
