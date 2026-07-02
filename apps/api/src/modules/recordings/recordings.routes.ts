/**
 * Recording routes (ARCHITECTURE.md §12 RECORDINGS).
 *
 * Reads are public-ish (auth still required); the upload endpoints are gated to
 * contributors/admins (§11 Authorization) because only they may add to the archive.
 */

import { Router } from 'express';
import { uploadUrlRequestSchema, uploadCompleteSchema, recordingQuerySchema } from '@sma/validators';
import { validate } from '@/shared/middleware/validate';
import { authenticate } from '@/shared/middleware/authenticate';
import { requireContributor } from '@/shared/middleware/requireRole';
import { asyncHandler } from '@/shared/http/asyncHandler';
import * as controller from './recordings.controller';

export const recordingsRouter: Router = Router();

// All recording endpoints require a signed-in user.
recordingsRouter.use(authenticate);

recordingsRouter.get('/', validate({ query: recordingQuerySchema }), asyncHandler(controller.list));
recordingsRouter.get('/:id', asyncHandler(controller.getById));
recordingsRouter.get('/:id/audio', asyncHandler(controller.getAudio));

// Contributor/admin only — adding to the archive.
recordingsRouter.post(
  '/upload-url',
  requireContributor,
  validate({ body: uploadUrlRequestSchema }),
  asyncHandler(controller.createUploadUrl),
);
recordingsRouter.post(
  '/upload-complete',
  requireContributor,
  validate({ body: uploadCompleteSchema }),
  asyncHandler(controller.completeUpload),
);
