import { describe, expect, it } from 'vitest';
import { studioAdapters, validateGenerationRequest } from '../studioGeneration';

describe('studio generation adapters', () => {
  it('offers only releasable adapters the service serves', () => {
    const ids = studioAdapters({
      available: true,
      adapters: ['base', 'oud', 'harvard_raw', 'large'],
    }).map((a) => a.id);
    expect(ids).toEqual(['oud', 'base']);
  });

  it('drops an allowlisted adapter the service marks research-only', () => {
    const ids = studioAdapters({
      available: true,
      adapters: ['base', 'oud'],
      adapters_research_only: ['oud'],
    }).map((a) => a.id);
    expect(ids).toEqual(['base']);
  });

  it('offers nothing when the service is down', () => {
    expect(studioAdapters({ available: false, adapters: ['oud'] })).toEqual([]);
  });
});

describe('generation request validation', () => {
  const ok = { prompt: 'slow qaraami on solo oud', duration: 10, seed: 42 };
  it('accepts the service schema', () => {
    expect(validateGenerationRequest(ok)).toBeNull();
  });
  it('rejects what the service would reject', () => {
    expect(validateGenerationRequest({ ...ok, prompt: ' a ' })).toMatch(/3 characters/);
    expect(validateGenerationRequest({ ...ok, prompt: 'x'.repeat(401) })).toMatch(/400/);
    expect(validateGenerationRequest({ ...ok, duration: 31 })).toMatch(/3–30/);
    expect(validateGenerationRequest({ ...ok, duration: 2.5 })).toMatch(/3–30/);
    expect(validateGenerationRequest({ ...ok, seed: -1 })).toMatch(/Seed/);
  });
});
