/**
 * Education routes (/api/v1/education) — educator-authored lessons.
 *
 * The platform is invite-only (SESSION "private access"), so ALL reads require
 * a signed-in member; drafts additionally stay author/admin-only (enforced in
 * the service). Authoring is role-gated: educator or admin. Attachments use
 * the presigned-R2 flow; files never pass through this API (CONVENTIONS.md
 * hard rule).
 */

import { Router } from 'express';
import {
  lessonCreateSchema,
  lessonUpdateSchema,
  lessonUploadUrlRequestSchema,
} from '@sma/validators';
import { validate } from '@/shared/middleware/validate';
import { authenticate } from '@/shared/middleware/authenticate';
import { requireEducator } from '@/shared/middleware/requireRole';
import { asyncHandler } from '@/shared/http/asyncHandler';
import * as controller from './education.controller';

export const educationRouter: Router = Router();

educationRouter.use(authenticate);

// Order matters: the static /lessons/mine must register before /lessons/:id.
educationRouter.get('/lessons/mine', requireEducator, asyncHandler(controller.listMine));
educationRouter.get('/lessons', asyncHandler(controller.listLessons));
educationRouter.get('/lessons/:id', asyncHandler(controller.getLesson));
educationRouter.get('/lessons/:id/file', asyncHandler(controller.getAttachmentUrl));

educationRouter.post(
  '/lessons/upload-url',
  requireEducator,
  validate({ body: lessonUploadUrlRequestSchema }),
  asyncHandler(controller.createUploadUrl),
);
educationRouter.post(
  '/lessons',
  requireEducator,
  validate({ body: lessonCreateSchema }),
  asyncHandler(controller.createLesson),
);
educationRouter.patch(
  '/lessons/:id',
  requireEducator,
  validate({ body: lessonUpdateSchema }),
  asyncHandler(controller.updateLesson),
);
educationRouter.delete('/lessons/:id', requireEducator, asyncHandler(controller.deleteLesson));
