/**
 * Search service (SESSION P3-04, ARCHITECTURE.md §12 SEARCH).
 *
 * Owns the read side of full-text search: query the search index for ranked hit
 * ids, then hydrate each to its full `PublicRecording` from the source of truth
 * (the index stores only ids — §5). Recordings that are no longer published are
 * dropped during hydration: the same defensive filter as similarity search
 * (recordings.service findSimilar), so a recording pulled from the archive can
 * never surface through a stale index entry between an unpublish and its removal.
 *
 * Injected deps (ADR-0005) so the whole path is unit-testable in-memory.
 */

import type { Paginated, PublicRecording } from '@sma/types';
import type { SearchQueryInput } from '@sma/validators';
import {
  recordingRepository,
  type RecordingRepository,
} from '@/modules/recordings/recordings.repository';
import { searchIndex, type SearchIndex } from './searchIndex';

export interface SearchServiceDeps {
  index: SearchIndex;
  recordings: RecordingRepository;
}

export function createSearchService(deps: SearchServiceDeps) {
  const { index, recordings } = deps;

  async function search(query: SearchQueryInput): Promise<Paginated<PublicRecording>> {
    const result = await index.search(query);

    const data: PublicRecording[] = [];
    for (const id of result.ids) {
      const recording = await recordings.findById(id);
      if (recording && recording.status === 'published') data.push(recording);
    }

    return {
      data,
      total: result.total,
      page: result.page,
      limit: result.limit,
      hasMore: result.hasMore,
    };
  }

  return { search };
}

export type SearchService = ReturnType<typeof createSearchService>;

export const searchService: SearchService = createSearchService({
  index: searchIndex,
  recordings: recordingRepository,
});
