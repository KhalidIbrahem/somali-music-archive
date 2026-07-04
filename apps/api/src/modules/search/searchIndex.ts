/**
 * Full-text search index (SESSION P3-04, ARCHITECTURE.md §5, §12 SEARCH).
 *
 * Production is Elasticsearch (index mapping in elasticsearch.mapping.ts, applied
 * by the future ES adapter). Interface-first (ADR-0005): this in-memory
 * implementation makes the indexing + search flow work and testable now, and
 * gives the search API a stable seam to build against — the ES adapter drops in
 * behind the same `SearchIndex` interface without any caller change.
 *
 * Only PUBLISHED recordings ever enter the index: the recordings/internal
 * services index on publish and remove on unpublish/archive (§12), so the index
 * itself enforces "search covers only the public archive". The searchable text is
 * the cultural metadata PLUS the AI transcripts (P3-01) — a listener can find a
 * recording by a lyric line, not just its title.
 *
 * Ranking mirrors Elasticsearch's analyzed-term relevance: text is tokenised into
 * lowercase word terms, matches are OR'd across query terms, and each hit is
 * scored by term frequency × per-field boost (title beats artist beats
 * transcript). Exact-term matching only — prefix/fuzzy matching is a later
 * enhancement (ES edge-ngram / fuzziness), not needed for the baseline API.
 */

import type { Genre, Region } from '@sma/constants';
import type { PublicRecording } from '@sma/types';
import type { SearchQueryInput } from '@sma/validators';

/**
 * The projection of a recording that is indexed and searched. Deliberately NOT
 * the whole recording: the index answers "which recordings match", then the
 * search service hydrates the full `PublicRecording` from the source of truth.
 */
export interface SearchDocument {
  /** The recording's ObjectId (`_id`) — the hydration key. */
  id: string;
  /** Somali title, plus the English title when one exists. */
  title: string;
  artistName: string;
  poetName?: string;
  genre: Genre;
  region?: Region;
  /** Decade string, e.g. "1970s". */
  era?: string;
  occasion?: string;
  /** AI transcript (P3-01) — makes recordings findable by their lyrics. */
  transcriptSomali?: string;
  transcriptEnglish?: string;
  /** ISO timestamp — recency tiebreak, and the sole order for an empty query. */
  createdAt: string;
}

/** A page of hit ids, best-ranked first, plus the paging envelope (§12). */
export interface SearchIndexResult {
  ids: string[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface SearchIndex {
  /** Insert or refresh a recording's searchable document (idempotent, keyed by id). */
  index(doc: SearchDocument): Promise<void>;
  /** Drop a recording from the index (unpublish/archive/delete). No-op if absent. */
  remove(id: string): Promise<void>;
  /**
   * Ranked full-text + facet search over the indexed (published) recordings.
   * Empty `q` returns every facet-matching document, newest first. In ES this is
   * a `bool` query (must: multi_match, filter: term facets); in-memory it is the
   * scoring below — same contract, same ordering guarantees.
   */
  search(query: SearchQueryInput): Promise<SearchIndexResult>;
  count(): Promise<number>;
  /** Empty the index — used by a full reindex/backfill and by tests. */
  clear(): Promise<void>;
}

/** Project a public recording onto the fields the index cares about. */
export function toSearchDocument(recording: PublicRecording): SearchDocument {
  const title = [recording.title.somali, recording.title.english]
    .filter((t): t is string => Boolean(t))
    .join(' ');
  return {
    id: String(recording._id),
    title,
    artistName: recording.artist.name,
    ...(recording.poet?.name ? { poetName: recording.poet.name } : {}),
    genre: recording.genre,
    ...(recording.region ? { region: recording.region } : {}),
    ...(recording.era ? { era: recording.era } : {}),
    ...(recording.occasion ? { occasion: recording.occasion } : {}),
    ...(recording.ai.transcriptSomali ? { transcriptSomali: recording.ai.transcriptSomali } : {}),
    ...(recording.ai.transcriptEnglish
      ? { transcriptEnglish: recording.ai.transcriptEnglish }
      : {}),
    createdAt: recording.createdAt,
  };
}

/** Field → relevance boost, mirroring the ES mapping's field weights. */
const FIELD_WEIGHTS: ReadonlyArray<{ key: keyof SearchDocument; weight: number }> = [
  { key: 'title', weight: 6 },
  { key: 'artistName', weight: 4 },
  { key: 'poetName', weight: 3 },
  { key: 'occasion', weight: 2 },
  { key: 'era', weight: 2 },
  { key: 'genre', weight: 2 },
  { key: 'transcriptSomali', weight: 1.5 },
  { key: 'transcriptEnglish', weight: 1 },
];

/**
 * Split text into lowercase word terms (the analyzer). `\p{L}\p{N}` keeps Somali
 * Latin letters and decade digits while dropping punctuation/whitespace.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** A weighted, pre-tokenised field ready to score against a query. */
interface WeightedField {
  weight: number;
  tokens: string[];
}

interface IndexedEntry {
  doc: SearchDocument;
  fields: WeightedField[];
  createdAtMs: number;
}

export class InMemorySearchIndex implements SearchIndex {
  private readonly byId = new Map<string, IndexedEntry>();

  async index(doc: SearchDocument): Promise<void> {
    const fields: WeightedField[] = FIELD_WEIGHTS.map(({ key, weight }) => {
      const value = doc[key];
      return { weight, tokens: typeof value === 'string' ? tokenize(value) : [] };
    });
    const createdAtMs = Date.parse(doc.createdAt);
    this.byId.set(doc.id, {
      doc,
      fields,
      createdAtMs: Number.isNaN(createdAtMs) ? 0 : createdAtMs,
    });
  }

  async remove(id: string): Promise<void> {
    this.byId.delete(id);
  }

  async search(query: SearchQueryInput): Promise<SearchIndexResult> {
    const queryTokens = query.q ? tokenize(query.q) : [];

    const scored: { entry: IndexedEntry; score: number }[] = [];
    for (const entry of this.byId.values()) {
      if (!matchesFacets(entry.doc, query)) continue;
      // Empty query → every facet match is a hit (score 0, ranked purely by recency).
      const score = queryTokens.length === 0 ? 0 : scoreEntry(entry, queryTokens);
      if (queryTokens.length > 0 && score === 0) continue;
      scored.push({ entry, score });
    }

    // Relevance first, newest-first as the tiebreak (and the sole order when empty).
    scored.sort((a, b) => b.score - a.score || b.entry.createdAtMs - a.entry.createdAtMs);

    const total = scored.length;
    const start = (query.page - 1) * query.limit;
    const ids = scored.slice(start, start + query.limit).map((s) => s.entry.doc.id);
    return {
      ids,
      total,
      page: query.page,
      limit: query.limit,
      hasMore: start + query.limit < total,
    };
  }

  async count(): Promise<number> {
    return this.byId.size;
  }

  async clear(): Promise<void> {
    this.byId.clear();
  }
}

/** Exact-match facet filters (genre/region/era) — the ES `filter` clause. */
function matchesFacets(doc: SearchDocument, query: SearchQueryInput): boolean {
  if (query.genre && doc.genre !== query.genre) return false;
  if (query.region && doc.region !== query.region) return false;
  if (query.era && doc.era !== query.era) return false;
  return true;
}

/** Sum term-frequency × field-boost across every query term (OR semantics). */
function scoreEntry(entry: IndexedEntry, queryTokens: string[]): number {
  let score = 0;
  for (const qt of queryTokens) {
    for (const field of entry.fields) {
      let tf = 0;
      for (const token of field.tokens) {
        if (token === qt) tf += 1;
      }
      if (tf > 0) score += tf * field.weight;
    }
  }
  return score;
}

/**
 * Process-wide index shared by the search service (reads) and the recordings /
 * internal services (writes). Swapped for the Elasticsearch adapter when
 * ELASTICSEARCH_URL is configured (docker compose --profile search).
 */
export const searchIndex: SearchIndex = new InMemorySearchIndex();
