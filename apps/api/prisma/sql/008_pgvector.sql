-- pgvector: audio-embedding storage (ARCHITECTURE.md §9, SESSION P3-03).
--
-- Raw SQL rather than Prisma schema because Prisma has no native vector type
-- (ADR-0006). Apply after the Prisma migrations:
--   psql "$POSTGRES_URL" -f prisma/sql/008_pgvector.sql
--
-- The local docker-compose Postgres is the pgvector/pgvector:pg16 image, so the
-- extension is available out of the box.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS audio_embeddings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id  TEXT NOT NULL UNIQUE,      -- MongoDB ObjectId as string
  embedding     vector(768) NOT NULL,      -- MERT-v1-95M output dimension
  model_version TEXT NOT NULL,             -- e.g. "mert-v1-95m"
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- IVFFlat approximate-nearest-neighbour index for cosine similarity (§9).
-- `lists` should track sqrt(row count): 100 suits the first ~10k recordings;
-- recreate with a larger value as the archive grows (§14).
CREATE INDEX IF NOT EXISTS audio_embeddings_embedding_idx
  ON audio_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
