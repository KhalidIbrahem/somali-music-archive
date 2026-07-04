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

export interface EmbeddingRepository {
  /** Insert or refresh the recording's embedding; returns the (stable) row id. */
  upsert(
    recordingId: string,
    embedding: readonly number[],
    modelVersion: string,
  ): Promise<{ id: string }>;
  get(recordingId: string): Promise<EmbeddingRecord | null>;
  count(): Promise<number>;
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

  async count(): Promise<number> {
    return this.byRecordingId.size;
  }
}

export const embeddingRepository: EmbeddingRepository = new InMemoryEmbeddingRepository();
