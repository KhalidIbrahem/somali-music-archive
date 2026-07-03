/**
 * Search controller (ARCHITECTURE.md §12 SEARCH). Delegates to the recordings
 * service's search (free text + genre/region/era facets). The in-memory substring
 * search is replaced by MongoDB text search / Elasticsearch in Phase 2/3 (§14),
 * behind the same repository interface.
 */

import type { Request, Response } from 'express';
import type { SearchQueryInput } from '@sma/validators';
import { sendSuccess } from '@/shared/http/respond';
import { recordingsService } from '@/modules/recordings/recordings.service';

export async function search(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as SearchQueryInput;
  const results = await recordingsService.searchRecordings(query);
  sendSuccess(res, results);
}
