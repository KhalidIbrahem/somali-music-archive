/**
 * Internal service authentication (SESSION P3-03, ARCHITECTURE.md §11).
 *
 * The Python AI service authenticates to internal endpoints with the shared
 * `x-internal-key` header (the same AI_SERVICE_API_KEY both services hold).
 * This is service-to-service auth, deliberately separate from user JWTs: an AI
 * worker acts for no user, and a leaked user token must never unlock internal
 * write paths. Comparison is timing-safe — a plain `===` would leak key bytes
 * through response timing.
 */

import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '@/config/env';
import { unauthorized } from '@/shared/errors/AppError';

export function requireInternalKey(req: Request, _res: Response, next: NextFunction): void {
  const presented = req.headers['x-internal-key'];
  const expected = env.AI_SERVICE_API_KEY;

  const presentedBuf = Buffer.from(typeof presented === 'string' ? presented : '');
  const expectedBuf = Buffer.from(expected);

  // timingSafeEqual requires equal lengths; a length mismatch is itself a fail.
  const matches =
    presentedBuf.length === expectedBuf.length && timingSafeEqual(presentedBuf, expectedBuf);

  if (!matches) {
    next(unauthorized('AUTH_INVALID_TOKEN', 'Invalid internal service key'));
    return;
  }
  next();
}
