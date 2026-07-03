/**
 * Search API call (ARCHITECTURE.md §12 SEARCH).
 */

import type { ApiResponse, Paginated, PublicRecording } from '@sma/types';
import type { SearchQueryInput } from '@sma/validators';
import { apiClient } from './client';
import { unwrap } from './unwrap';

export async function searchRecordings(
  query: Partial<SearchQueryInput>,
): Promise<Paginated<PublicRecording>> {
  const res = await apiClient.get<ApiResponse<Paginated<PublicRecording>>>('/search', {
    params: query,
  });
  return unwrap(res.data);
}
