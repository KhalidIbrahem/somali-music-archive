/**
 * Access-token blacklist (ARCHITECTURE.md §8 step 6, §11).
 *
 * Access tokens are stateless JWTs, so "logging out" a still-valid token requires
 * an explicit deny-list. On logout we add the token's `jti` here for the remainder
 * of its short TTL; `authenticate` rejects any token whose `jti` is listed.
 *
 * The interface is Redis-shaped (Upstash in production, §5) — Redis `SET jti "" EX
 * ttl` maps 1:1 onto `add`. Phase 0/1 ships an in-memory implementation so the
 * flow runs and is testable with zero infrastructure (ADR-0005); the Redis-backed
 * implementation swaps in behind this interface without touching callers.
 */

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

/** Process-wide default. Swap for a RedisTokenBlacklist in production. */
export const tokenBlacklist: TokenBlacklist = new InMemoryTokenBlacklist();
