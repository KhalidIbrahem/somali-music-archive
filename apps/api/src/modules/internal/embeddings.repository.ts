/**
 * Audio-embedding persistence (SESSION P3-03, ARCHITECTURE.md §9 audio_embeddings).
 *
 * Production is PostgreSQL + pgvector — `vector(768)` column with an IVFFlat
 * cosine index (DDL in prisma/sql/008_pgvector.sql; raw SQL because Prisma has
 * no native vector type, ADR-0006). Interface-first (ADR-0005): this in-memory
 * implementation makes the callback flow work and testable now, and gives
 * P3-05 (similarity search) a seam to build against.
 *
 * Upsert keyed by recording (one embedding per recording per §9's UNIQUE
 * constraint): re-running the AI pipeline refreshes the vector, keeping the row
 * id stable so recordings' `embeddingId` references never dangle.
 */

import { randomUUID } from '@/shared/crypto';

export interface EmbeddingRecord {
  id: string;
  recordingId: string;
  embedding: readonly number[];
  modelVersion: string;
  createdAt: Date;
}

/** One nearest-neighbour hit: which recording, and how close (cosine, −1..1). */
export interface SimilarityHit {
  recordingId: string;
  similarity: number;
}

export interface EmbeddingRepository {
  /** Insert or refresh the recording's embedding; returns the (stable) row id. */
  upsert(
    recordingId: string,
    embedding: readonly number[],
    modelVersion: string,
  ): Promise<{ id: string }>;
  get(recordingId: string): Promise<EmbeddingRecord | null>;
  /**
   * Nearest neighbours of a recording's embedding, best first, self excluded.
   * Empty when the recording has no embedding yet (AI still processing).
   * pgvector executes this as `ORDER BY embedding <=> query LIMIT n` over the
   * IVFFlat index (§9); in-memory it is an exact cosine scan — same contract.
   */
  findSimilar(recordingId: string, limit: number): Promise<SimilarityHit[]>;
  count(): Promise<number>;
}

/**
 * Cosine similarity, the metric the pgvector index is built on (§9).
 * Stored vectors are L2-normalised by the AI service (P3-03), which makes this
 * equal to the dot product — but computing the full quotient keeps the function
 * correct for ANY input, so tests and future callers can't be silently wrong.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class InMemoryEmbeddingRepository implements EmbeddingRepository {
  private readonly byRecordingId = new Map<string, EmbeddingRecord>();

  async upsert(
    recordingId: string,
    embedding: readonly number[],
    modelVersion: string,
  ): Promise<{ id: string }> {
    const existing = this.byRecordingId.get(recordingId);
    const record: EmbeddingRecord = {
      id: existing?.id ?? randomUUID(),
      recordingId,
      embedding: [...embedding],
      modelVersion,
      createdAt: existing?.createdAt ?? new Date(),
    };
    this.byRecordingId.set(recordingId, record);
    return { id: record.id };
  }

  async get(recordingId: string): Promise<EmbeddingRecord | null> {
    return this.byRecordingId.get(recordingId) ?? null;
  }

  async findSimilar(recordingId: string, limit: number): Promise<SimilarityHit[]> {
    const query = this.byRecordingId.get(recordingId);
    if (!query) return [];
    const hits: SimilarityHit[] = [];
    for (const candidate of this.byRecordingId.values()) {
      if (candidate.recordingId === recordingId) continue; // never "similar to itself"
      hits.push({
        recordingId: candidate.recordingId,
        similarity: cosineSimilarity(query.embedding, candidate.embedding),
      });
    }
    return hits.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  async count(): Promise<number> {
    return this.byRecordingId.size;
  }
}

export const embeddingRepository: EmbeddingRepository = new InMemoryEmbeddingRepository();
