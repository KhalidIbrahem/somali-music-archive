/**
 * Authentication middleware — verifies the `Authorization: Bearer <jwt>` access
 * token and attaches `req.user` (ARCHITECTURE.md §8, §11).
 *
 * NOTE: a full implementation also checks the Redis blacklist for revoked tokens
 * (§11 Authentication checklist). That check is delegated to the auth module's
 * token store and wired here in Phase 1; the signature verification below is the
 * foundation it builds on.
 */

import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '@/shared/errors/AppError';
import { verifyAccessToken } from '@/modules/auth/token.service';

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(unauthorized('AUTH_INVALID_TOKEN', 'Missing bearer token'));
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (err) {
    next(err);
  }
}
