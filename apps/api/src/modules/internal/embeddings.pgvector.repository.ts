/**
 * pgvector audio-embedding persistence (SESSION "db-backed repositories",
 * ARCHITECTURE.md §9 audio_embeddings, SESSION P3-03/P3-05).
 *
 * The production EmbeddingRepository. Raw SQL via Prisma `$queryRaw` because Prisma
 * has no native `vector` type (ADR-0006) — the `audio_embeddings` table + IVFFlat
 * index are created by prisma/sql/008_pgvector.sql, which must be applied to the
 * database before this repository is used. Binds in place of the in-memory version
 * when PERSISTENCE=database.
 *
 * Similarity is cosine, computed by the `<=>` operator over the IVFFlat index;
 * `similarity = 1 - distance`, matching the in-memory cosine contract.
 */

import type { PrismaClient } from '@prisma/client';
import type { EmbeddingRecord, EmbeddingRepository, SimilarityHit } from './embeddings.repository';

/** pgvector's text input format for a vector literal: `[v1,v2,...]`. */
function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
}

export class PgVectorEmbeddingRepository implements EmbeddingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(
    recordingId: string,
    embedding: readonly number[],
    modelVersion: string,
  ): Promise<{ id: string }> {
    const literal = toVectorLiteral(embedding);
    // One embedding per recording (recording_id UNIQUE); re-running refreshes it
    // while keeping the row id stable so recordings' embeddingId never dangles.
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO audio_embeddings (recording_id, embedding, model_version)
      VALUES (${recordingId}, ${literal}::vector, ${modelVersion})
      ON CONFLICT (recording_id) DO UPDATE
        SET embedding = EXCLUDED.embedding, model_version = EXCLUDED.model_version
      RETURNING id::text AS id;
    `;
    const id = rows[0]?.id;
    if (!id) throw new Error('audio_embeddings upsert returned no id');
    return { id };
  }

  async get(recordingId: string): Promise<EmbeddingRecord | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; embedding: string; model_version: string; created_at: Date }>
    >`
      SELECT id::text AS id, embedding::text AS embedding, model_version, created_at
      FROM audio_embeddings
      WHERE recording_id = ${recordingId};
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      recordingId,
      embedding: JSON.parse(row.embedding) as number[], // pgvector ::text is a JSON array
      modelVersion: row.model_version,
      createdAt: row.created_at,
    };
  }

  async findSimilar(recordingId: string, limit: number): Promise<SimilarityHit[]> {
    // Nearest neighbours by cosine distance over the IVFFlat index, self excluded.
    // Empty when the recording has no embedding yet (the self-join yields nothing).
    const rows = await this.prisma.$queryRaw<Array<{ recording_id: string; similarity: number }>>`
      SELECT e2.recording_id AS recording_id,
             1 - (e2.embedding <=> e1.embedding) AS similarity
      FROM audio_embeddings e1
      JOIN audio_embeddings e2 ON e2.recording_id <> e1.recording_id
      WHERE e1.recording_id = ${recordingId}
      ORDER BY e2.embedding <=> e1.embedding
      LIMIT ${limit};
    `;
    return rows.map((r) => ({ recordingId: r.recording_id, similarity: r.similarity }));
  }

  async count(): Promise<number> {
    const rows = await this.prisma.$queryRaw<
      Array<{ count: number }>
    >`SELECT count(*)::int AS count FROM audio_embeddings;`;
    return rows[0]?.count ?? 0;
  }
}
