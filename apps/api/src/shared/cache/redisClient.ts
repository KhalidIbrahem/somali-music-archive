/**
 * Shared Redis client (Upstash in production, ARCHITECTURE.md §5).
 *
 * Lazy singleton around node-redis, used by the auth rate limiter and the
 * logout token blacklist when RATE_LIMIT_BACKEND=redis — the two pieces of
 * auth state that must be shared across instances/lambdas. Deliberately
 * env-light (reads process.env directly, mirroring shared/db/driver.ts) so
 * importing modules stay usable in script contexts. Boot code calls
 * connectRedis() eagerly so a bad URL fails at startup, not mid-request.
 */

import { createClient } from 'redis';

export type RedisClient = ReturnType<typeof createClient>;

/** True when the Redis-backed rate limiter + token blacklist should be used.
 * Never in tests — suites run with zero infrastructure (ADR-0005). */
export function useRedisBackend(): boolean {
  return process.env['NODE_ENV'] !== 'test' && process.env['RATE_LIMIT_BACKEND'] === 'redis';
}

let client: RedisClient | null = null;

export function getRedis(): RedisClient {
  if (!client) {
    // REDIS_URL is guaranteed by envSchema when the server boots; the fallback
    // spread only satisfies exactOptionalPropertyTypes for script contexts.
    const url = process.env['REDIS_URL'];
    client = createClient(url ? { url } : {});
    // Without an 'error' listener a dropped connection crashes the process via
    // an unhandled error event; node-redis reconnects on its own.
    client.on('error', (error: Error) => {
      // eslint-disable-next-line no-console -- env-light module; no logger import
      console.warn('[redis] client error:', error.message);
    });
  }
  return client;
}

export async function connectRedis(): Promise<void> {
  const c = getRedis();
  if (!c.isOpen) await c.connect();
}

export async function disconnectRedis(): Promise<void> {
  if (client?.isOpen) await client.close();
}
