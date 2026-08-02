/**
 * Rate limiting (ARCHITECTURE.md §11 API Security, Threat 2/6).
 *
 * Two tiers: a strict limiter for auth endpoints (credential stuffing / brute
 * force) and a general limiter for everything else. With RATE_LIMIT_BACKEND=redis
 * the AUTH limiter's counters live in Redis (Upstash) so the brute-force limit
 * holds across instances/lambdas; the general limiter deliberately stays
 * in-memory per process — one Redis round-trip on every API request is not worth
 * it for a coarse volume cap. Responses use our error envelope.
 */

import type { Request, Response } from 'express';
import rateLimit, {
  ipKeyGenerator,
  type Options,
  type RateLimitRequestHandler,
} from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { sendError } from '@/shared/http/respond';
import { isTest } from '@/config/env';
import { connectRedis, getRedis, useRedisBackend } from '@/shared/cache/redisClient';

const MINUTE = 60 * 1000;

/** What rate-limit-redis expects back from a raw command. */
type RedisReply = boolean | number | string | Array<boolean | number | string>;

/** Redis-backed store. express-rate-limit calls the store's init (which loads a
 * Lua script) at construction — i.e. at module import, before boot has opened
 * the connection — so every command ensures the client is connected first.
 * connectRedis() is a no-op boolean check once the connection is up. */
function redisStore(prefix: string): RedisStore {
  return new RedisStore({
    prefix,
    sendCommand: async (...args: string[]) => {
      await connectRedis();
      return (await getRedis().sendCommand(args)) as unknown as RedisReply;
    },
  });
}

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
  ...(useRedisBackend() ? { store: redisStore('rl:auth:') } : {}),
});

/** General: 1000 requests / hour / IP (§11 API Security). */
export const generalLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * MINUTE,
  limit: 1000,
  ...common,
});

/**
 * AI generation: 10 submissions / hour / USER (not IP — each request spends real
 * provider money, so the JWT identity is the correct cost unit; per-IP would let
 * one user behind a campus NAT exhaust everyone's cap and be trivially dodged by
 * rotation). Mounted AFTER `authenticate`, so req.user exists; the IPv6-safe IP
 * fallback only fires if the route order is ever broken. Redis-backed when
 * available for the same cross-instance reason as the auth limiter. Applies to
 * POST only — status polls ride the general limiter.
 */
export const generationLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * MINUTE,
  limit: 10,
  keyGenerator: (req: Request) => (req.user ? `user:${req.user.id}` : ipKeyGenerator(req.ip ?? '')),
  ...common,
  ...(useRedisBackend() ? { store: redisStore('rl:gen:') } : {}),
});
