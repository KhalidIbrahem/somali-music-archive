/**
 * Recording routes (ARCHITECTURE.md §12 RECORDINGS).
 *
 * Reads are public-ish (auth still required); the upload endpoints are gated to
 * contributors/admins (§11 Authorization) because only they may add to the archive.
 */

import { Router } from 'express';
import {
  uploadUrlRequestSchema,
  uploadCompleteSchema,
  recordingQuerySchema,
  moderationQuerySchema,
  recordingModerationSchema,
} from '@sma/validators';
import { validate } from '@/shared/middleware/validate';
import { authenticate } from '@/shared/middleware/authenticate';
import { requireContributor, requireAdmin } from '@/shared/middleware/requireRole';
import { requireVerifiedEmail } from '@/shared/middleware/requireVerifiedEmail';
import { asyncHandler } from '@/shared/http/asyncHandler';
import * as controller from './recordings.controller';

export const recordingsRouter: Router = Router();

// All recording endpoints require a signed-in user.
recordingsRouter.use(authenticate);

recordingsRouter.get('/', validate({ query: recordingQuerySchema }), asyncHandler(controller.list));

// Admin moderation — must be registered before the /:id param route.
recordingsRouter.get(
  '/moderation',
  requireAdmin,
  validate({ query: moderationQuerySchema }),
  asyncHandler(controller.moderationList),
);

// Vector similarity ("similar recordings", §12) — literal path before /:id.
recordingsRouter.get('/similar/:id', asyncHandler(controller.getSimilar));

recordingsRouter.get('/:id', asyncHandler(controller.getById));
recordingsRouter.get('/:id/audio', asyncHandler(controller.getAudio));

// Admin: change a recording's status/visibility (publish, archive, …).
recordingsRouter.patch(
  '/:id',
  requireAdmin,
  validate({ body: recordingModerationSchema }),
  asyncHandler(controller.updateRecording),
);

// Contributor/admin only, and only with a verified email — adding to the archive
// is "full access" (§11 — email verification required before full access).
recordingsRouter.post(
  '/upload-url',
  requireContributor,
  requireVerifiedEmail,
  validate({ body: uploadUrlRequestSchema }),
  asyncHandler(controller.createUploadUrl),
);
recordingsRouter.post(
  '/upload-complete',
  requireContributor,
  requireVerifiedEmail,
  validate({ body: uploadCompleteSchema }),
  asyncHandler(controller.completeUpload),
);
