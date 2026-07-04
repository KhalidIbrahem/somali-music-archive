/**
 * Elasticsearch index definition (SESSION P3-04, ARCHITECTURE.md §5).
 *
 * The production full-text backend. Like the pgvector DDL (prisma/sql/008_pgvector.sql,
 * ADR-0006), this is the schema the real store expects — declared and version-
 * controlled ahead of the adapter that applies it, so the in-memory index
 * (searchIndex.ts) and the eventual ES index share one contract. The future ES
 * adapter creates the index with exactly this settings/mappings body:
 *
 *   PUT /{RECORDINGS_INDEX}   { settings, mappings }
 *
 * ES only comes up under `docker compose --profile search up -d` (it is heavy,
 * ADR-0008). When ELASTICSEARCH_URL is empty the API uses the in-memory index and
 * this definition is inert documentation.
 *
 * Field boosts here mirror InMemorySearchIndex's FIELD_WEIGHTS so ranking is the
 * same whichever backend is live. The `_source` is disabled: a hit only carries
 * the document id, and the search service hydrates the full recording from
 * MongoDB (the source of truth) — the index is never a second copy of the data.
 */

/** The recordings full-text index name (overridable via ELASTICSEARCH_INDEX). */
export const RECORDINGS_INDEX = 'recordings';

/**
 * Analyzers: a light folding analyzer (lowercase + ASCII-fold) covers Somali Latin
 * text and the transliterated English gloss well enough for the first archive.
 * Genre/region/era are keyword facets (exact-match filters, no analysis).
 */
export const recordingsIndexDefinition = {
  settings: {
    analysis: {
      analyzer: {
        somali_text: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'asciifolding'],
        },
      },
    },
  },
  mappings: {
    // Hits carry only the id; the recording is hydrated from MongoDB (§5).
    _source: { enabled: false },
    properties: {
      title: { type: 'text', analyzer: 'somali_text', boost: 6 },
      artistName: { type: 'text', analyzer: 'somali_text', boost: 4 },
      poetName: { type: 'text', analyzer: 'somali_text', boost: 3 },
      occasion: { type: 'text', analyzer: 'somali_text', boost: 2 },
      transcriptSomali: { type: 'text', analyzer: 'somali_text', boost: 1.5 },
      transcriptEnglish: { type: 'text', analyzer: 'somali_text', boost: 1 },
      // Facets — exact-match filters and (era) the recency-independent grouping key.
      genre: { type: 'keyword' },
      region: { type: 'keyword' },
      era: { type: 'keyword' },
      createdAt: { type: 'date' },
    },
  },
} as const;
