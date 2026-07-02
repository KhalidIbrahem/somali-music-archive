/**
 * Rate limiting (ARCHITECTURE.md §11 API Security, Threat 2/6).
 *
 * Two tiers: a strict limiter for auth endpoints (credential stuffing / brute
 * force) and a general limiter for everything else. In production the store is
 * backed by Redis so limits hold across multiple API instances (§14); the default
 * in-memory store is used in dev/test. Responses use our error envelope.
 */

import type { Request, Response } from 'express';
import rateLimit, { type Options, type RateLimitRequestHandler } from 'express-rate-limit';
import { sendError } from '@/shared/http/respond';
import { isTest } from '@/config/env';

const MINUTE = 60 * 1000;

const common: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: false,
  // Disable during tests so suites aren't throttled.
  skip: () => isTest,
  handler: (_req: Request, res: Response) =>
    sendError(res, 429, { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' }),
};

/** Auth: 5 attempts / 15 min / IP (§11 Threat 2). */
export const authLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * MINUTE,
  limit: 5,
  ...common,
});

/** General: 1000 requests / hour / IP (§11 API Security). */
export const generalLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * MINUTE,
  limit: 1000,
  ...common,
});
