/**
 * Search controller (ARCHITECTURE.md §12 SEARCH). Delegates to the search service,
 * which runs a ranked full-text + facet (genre/region/era) query over the search
 * index and hydrates the hits to full recordings (SESSION P3-04). Production swaps
 * the in-memory index for Elasticsearch behind the same `SearchIndex` interface.
 */

import type { Request, Response } from 'express';
import type { SearchQueryInput } from '@sma/validators';
import { sendSuccess } from '@/shared/http/respond';
import { searchService } from './search.service';

export async function search(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as SearchQueryInput;
  const results = await searchService.search(query);
  sendSuccess(res, results);
}
