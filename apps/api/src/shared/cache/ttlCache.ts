/**
 * Tiny in-process TTL cache (SESSION P4-07, ARCHITECTURE.md §14 scale).
 *
 * A per-instance, string-keyed cache with a fixed time-to-live — used to serve hot,
 * rarely-changing reads (e.g. the discover feed) without hitting the database on
 * every request. Deliberately in-process and dependency-free; at multi-instance
 * scale this seam is where a shared Redis cache slots in. The clock is injectable so
 * expiry is unit-testable without timers.
 */

export interface TtlCacheOptions {
  /** Entry lifetime in milliseconds. */
  ttlMs: number;
  /** Clock, injectable for tests. Defaults to `Date.now`. */
  now?: () => number;
}

export class TtlCache<T> {
  private readonly store = new Map<string, { value: T; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: TtlCacheOptions) {
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? (() => Date.now());
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key); // lazily evict on read
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  /** Return the cached value, or compute + store it on a miss. */
  async getOrCompute(key: string, compute: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await compute();
    this.set(key, value);
    return value;
  }

  /** Drop everything (call on a write that could change any cached read). */
  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
