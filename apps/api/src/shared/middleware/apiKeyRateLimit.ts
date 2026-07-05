/**
 * Per-API-key rate limiting (SESSION P3-07, ARCHITECTURE.md §11 API Security).
 *
 * Runs after requireApiKey and enforces each key's own hourly budget
 * (`req.apiKey.rateLimit`) — unlike the IP-based limiter, the subject is the key.
 * A fixed-window in-memory counter; production would back this with Redis so the
 * window is shared across API instances (§14). Disabled under tests.
 */

import type { NextFunction, Request, Response } from 'express';
import { isTest } from '@/config/env';
import { tooManyRequests } from '@/shared/errors/AppError';

const WINDOW_MS = 60 * 60 * 1000; // one hour

interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();

export function apiKeyRateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = req.apiKey;
  if (isTest || !key) {
    next();
    return;
  }

  const now = Date.now();
  let bucket = buckets.get(key.id);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key.id, bucket);
  }
  bucket.count += 1;

  res.setHeader('RateLimit-Limit', String(key.rateLimit));
  res.setHeader('RateLimit-Remaining', String(Math.max(0, key.rateLimit - bucket.count)));
  res.setHeader('RateLimit-Reset', String(Math.ceil((bucket.resetAt - now) / 1000)));

  if (bucket.count > key.rateLimit) {
    next(tooManyRequests('API key hourly rate limit exceeded'));
    return;
  }
  next();
}
