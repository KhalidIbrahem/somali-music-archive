import { describe, it, expect, beforeEach } from 'vitest';
import { cosineSimilarity, InMemoryEmbeddingRepository } from './embeddings.repository';

describe('cosineSimilarity', () => {
  it('is 1 for identical directions, regardless of magnitude', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([1, 2, 2], [10, 20, 20])).toBeCloseTo(1, 10);
  });

  it('is 0 for orthogonal vectors and -1 for opposite ones', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });

  it('degrades to 0 for a zero vector instead of dividing by zero', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });
});

describe('InMemoryEmbeddingRepository.findSimilar', () => {
  let repo: InMemoryEmbeddingRepository;

  beforeEach(async () => {
    repo = new InMemoryEmbeddingRepository();
    await repo.upsert('query', [1, 0, 0], 'mert-v1-95m');
    await repo.upsert('near', [0.9, 0.1, 0], 'mert-v1-95m');
    await repo.upsert('mid', [0.6, 0.8, 0], 'mert-v1-95m');
    await repo.upsert('far', [0, 1, 0], 'mert-v1-95m');
  });

  it('returns neighbours best-first with their similarity, excluding self', async () => {
    const hits = await repo.findSimilar('query', 10);
    expect(hits.map((h) => h.recordingId)).toEqual(['near', 'mid', 'far']);
    expect(hits[0]?.similarity).toBeGreaterThan(hits[1]?.similarity ?? 0);
    expect(hits.every((h) => h.recordingId !== 'query')).toBe(true);
  });

  it('respects the limit', async () => {
    expect(await repo.findSimilar('query', 1)).toHaveLength(1);
  });

  it('is empty when the recording has no embedding yet', async () => {
    expect(await repo.findSimilar('unknown', 10)).toEqual([]);
  });
});
