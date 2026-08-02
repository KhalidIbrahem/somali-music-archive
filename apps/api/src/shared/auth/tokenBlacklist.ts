/**
 * Access-token blacklist (ARCHITECTURE.md §8 step 6, §11).
 *
 * Access tokens are stateless JWTs, so "logging out" a still-valid token requires
 * an explicit deny-list. On logout we add the token's `jti` here for the remainder
 * of its short TTL; `authenticate` rejects any token whose `jti` is listed.
 *
 * The interface is Redis-shaped (Upstash in production, §5) — Redis `SET jti "" EX
 * ttl` maps 1:1 onto `add`. The in-memory implementation keeps the flow runnable
 * and testable with zero infrastructure (ADR-0005); RATE_LIMIT_BACKEND=redis
 * selects the Redis implementation so logout holds across instances/lambdas.
 */

import { connectRedis, getRedis, useRedisBackend } from '@/shared/cache/redisClient';

export interface TokenBlacklist {
  /** Deny a token id for `ttlSeconds` (its remaining lifetime). */
  add(jti: string, ttlSeconds: number): Promise<void>;
  /** True while the token id is denied. */
  has(jti: string): Promise<boolean>;
}

/** In-memory blacklist with lazy TTL expiry. Not shared across processes — that is
 * exactly what the Redis implementation provides in production. */
export class InMemoryTokenBlacklist implements TokenBlacklist {
  private readonly entries = new Map<string, number>(); // jti → expiresAt (ms)

  async add(jti: string, ttlSeconds: number): Promise<void> {
    this.entries.set(jti, Date.now() + ttlSeconds * 1000);
  }

  async has(jti: string): Promise<boolean> {
    const expiresAt = this.entries.get(jti);
    if (expiresAt === undefined) return false;
    if (Date.now() > expiresAt) {
      this.entries.delete(jti); // lazy cleanup
      return false;
    }
    return true;
  }
}

/** Redis-backed blacklist: shared across every instance/lambda. Keys are
 * namespaced (`bl:<jti>`) and expire exactly when the token itself would. */
export class RedisTokenBlacklist implements TokenBlacklist {
  async add(jti: string, ttlSeconds: number): Promise<void> {
    // An already-expired token needs no deny-list entry (SET EX rejects <= 0).
    if (ttlSeconds <= 0) return;
    await connectRedis(); // no-op once the connection is up
    await getRedis().set(`bl:${jti}`, '', { EX: ttlSeconds });
  }

  async has(jti: string): Promise<boolean> {
    await connectRedis();
    return (await getRedis().exists(`bl:${jti}`)) > 0;
  }
}

/** Process-wide default, selected the same way as the repositories (driver flag). */
export const tokenBlacklist: TokenBlacklist = useRedisBackend()
  ? new RedisTokenBlacklist()
  : new InMemoryTokenBlacklist();
