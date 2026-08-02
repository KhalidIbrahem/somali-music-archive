/**
 * Generation routes (/api/v1/generate).
 *
 * POST /          — submit a generation job (auth + per-USER limiter: each call
 *                   spends provider money, so authenticate runs FIRST and the
 *                   limiter keys on req.user.id).
 * GET  /:jobId    — poll a job (auth; rides the general limiter — clients are
 *                   documented to poll every ≥3s).
 * POST /callback  — the Suno reseller's required webhook target; public,
 *                   validated-permissive, ignored (see controller docblock).
 */

import { Router } from 'express';
import {
  generateRequestSchema,
  generationCallbackSchema,
  generationJobParamsSchema,
} from '@sma/validators';
import { validate } from '@/shared/middleware/validate';
import { authenticate } from '@/shared/middleware/authenticate';
import { generationLimiter } from '@/shared/middleware/rateLimit';
import { asyncHandler } from '@/shared/http/asyncHandler';
import * as controller from './generation.controller';

export const generationRouter: Router = Router();

generationRouter.post(
  '/callback',
  validate({ body: generationCallbackSchema }),
  asyncHandler(controller.generationCallback),
);

generationRouter.post(
  '/',
  authenticate,
  generationLimiter,
  validate({ body: generateRequestSchema }),
  asyncHandler(controller.createGeneration),
);

generationRouter.get(
  '/:jobId',
  authenticate,
  validate({ params: generationJobParamsSchema }),
  asyncHandler(controller.getGeneration),
);
