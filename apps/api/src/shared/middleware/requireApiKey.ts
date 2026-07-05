/**
 * Research API key authentication (SESSION P3-07, ARCHITECTURE.md §11).
 *
 * External researchers present their key via `Authorization: Bearer <key>` or the
 * `x-api-key` header. This resolves it to an active key record and attaches the
 * principal to `req.apiKey`; unknown / revoked / expired keys are rejected. Kept
 * separate from user JWT auth (`authenticate`) and internal-service auth: a
 * research key acts for a data consumer, not a logged-in app user.
 */

import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '@/shared/errors/AppError';
import { researchService } from '@/modules/research/research.service';

function extractKey(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  const apiKeyHeader = req.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.length > 0) return apiKeyHeader;
  return null;
}

export async function requireApiKey(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const presented = extractKey(req);
    if (!presented) {
      next(unauthorized('AUTH_INVALID_TOKEN', 'An API key is required'));
      return;
    }
    const record = await researchService.verifyApiKey(presented);
    if (!record) {
      next(unauthorized('AUTH_INVALID_TOKEN', 'Invalid or expired API key'));
      return;
    }
    req.apiKey = {
      id: record.id,
      userId: record.userId,
      plan: record.plan,
      rateLimit: record.rateLimit,
    };
    next();
  } catch (err) {
    next(err);
  }
}
