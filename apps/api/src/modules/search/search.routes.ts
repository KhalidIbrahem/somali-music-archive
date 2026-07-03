/**
 * Search route (ARCHITECTURE.md §12 SEARCH): GET /search?q=&genre=&region=&era=.
 * Requires a signed-in user; the query is validated with the shared schema.
 */

import { Router } from 'express';
import { searchQuerySchema } from '@sma/validators';
import { validate } from '@/shared/middleware/validate';
import { authenticate } from '@/shared/middleware/authenticate';
import { asyncHandler } from '@/shared/http/asyncHandler';
import * as controller from './search.controller';

export const searchRouter: Router = Router();

searchRouter.use(authenticate);
searchRouter.get('/', validate({ query: searchQuerySchema }), asyncHandler(controller.search));
