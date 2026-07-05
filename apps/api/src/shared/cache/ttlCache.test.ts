import { describe, it, expect, vi } from 'vitest';
import { TtlCache } from './ttlCache';

describe('TtlCache', () => {
  it('returns a cached value within the TTL and recomputes after it', async () => {
    let clock = 1000;
    const cache = new TtlCache<number>({ ttlMs: 100, now: () => clock });
    const compute = vi.fn(async () => 42);

    expect(await cache.getOrCompute('k', compute)).toBe(42);
    clock = 1050; // still fresh
    expect(await cache.getOrCompute('k', compute)).toBe(42);
    expect(compute).toHaveBeenCalledTimes(1); // served from cache

    clock = 1200; // past TTL
    await cache.getOrCompute('k', compute);
    expect(compute).toHaveBeenCalledTimes(2); // recomputed
  });

  it('keys entries independently', async () => {
    const cache = new TtlCache<string>({ ttlMs: 1000 });
    cache.set('a', 'x');
    cache.set('b', 'y');
    expect(cache.get('a')).toBe('x');
    expect(cache.get('b')).toBe('y');
    expect(cache.get('c')).toBeUndefined();
  });

  it('clear() drops everything', () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 });
    cache.set('a', 1);
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});
