/**
 * Research routes (ARCHITECTURE.md §12 RESEARCH, SESSION P3-07).
 *
 * Two audiences, two auth schemes on one router:
 *  - /keys — a signed-in user manages their own research keys (JWT).
 *  - /dataset — external researchers pull the corpus with an API key, rate-limited
 *    per key. No JWT: the key IS the credential.
 */

import { Router } from 'express';
import { createApiKeySchema, researchDatasetQuerySchema } from '@sma/validators';
import { validate } from '@/shared/middleware/validate';
import { authenticate } from '@/shared/middleware/authenticate';
import { requireApiKey } from '@/shared/middleware/requireApiKey';
import { apiKeyRateLimit } from '@/shared/middleware/apiKeyRateLimit';
import { asyncHandler } from '@/shared/http/asyncHandler';
import * as controller from './research.controller';

export const researchRouter: Router = Router();

// ── Key management (JWT) ──────────────────────────────────────────────────────
researchRouter.post(
  '/keys',
  authenticate,
  validate({ body: createApiKeySchema }),
  asyncHandler(controller.createKey),
);
researchRouter.get('/keys', authenticate, asyncHandler(controller.listKeys));
researchRouter.delete('/keys/:id', authenticate, asyncHandler(controller.revokeKey));

// ── Dataset export (API key + per-key rate limit) ─────────────────────────────
researchRouter.get(
  '/dataset',
  requireApiKey,
  apiKeyRateLimit,
  validate({ query: researchDatasetQuerySchema }),
  asyncHandler(controller.getDataset),
);
