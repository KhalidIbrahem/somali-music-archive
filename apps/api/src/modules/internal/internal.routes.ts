/**
 * Internal service-to-service routes (SESSION P3-03, ARCHITECTURE.md §10, §11).
 *
 * Only the AI service calls these — authenticated with the shared internal key
 * (timing-safe), never user JWTs. Every payload is Zod-validated: a bug in the
 * AI service must not be able to write garbage into the archive.
 */

import { Router } from 'express';
import { aiResultSchema } from '@sma/validators';
import { validate } from '@/shared/middleware/validate';
import { requireInternalKey } from '@/shared/middleware/requireInternalKey';
import { asyncHandler } from '@/shared/http/asyncHandler';
import * as controller from './internal.controller';

export const internalRouter: Router = Router();

internalRouter.use(requireInternalKey);

internalRouter.post(
  '/recordings/:id/ai',
  validate({ body: aiResultSchema }),
  asyncHandler(controller.receiveAiResult),
);
