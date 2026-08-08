/**
 * Education routes (/api/v1/education) — educator-authored lessons.
 *
 * Reading published lessons is PUBLIC (students and visitors need no account —
 * the professor shares a link and it just works). Authoring is role-gated:
 * educator or admin (granted by an admin; see users routes / promote script).
 * Attachments use the presigned-R2 flow; files never pass through this API
 * (CONVENTIONS.md hard rule).
 */

import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
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

/** Attach `req.user` when a bearer token is present; stay anonymous otherwise.
 * Lets one handler serve public reads AND author-only draft views. A present-
 * but-invalid token is still rejected — silently ignoring it would confuse
 * clients into thinking they are signed in. */
function maybeAuthenticate(req: Request, res: Response, next: NextFunction): void {
  if (!req.headers.authorization) {
    next();
    return;
  }
  void authenticate(req, res, next);
}

// Order matters: the static /lessons/mine must register before /lessons/:id.
educationRouter.get(
  '/lessons/mine',
  authenticate,
  requireEducator,
  asyncHandler(controller.listMine),
);
educationRouter.get('/lessons', asyncHandler(controller.listLessons));
educationRouter.get('/lessons/:id', maybeAuthenticate, asyncHandler(controller.getLesson));
educationRouter.get(
  '/lessons/:id/file',
  maybeAuthenticate,
  asyncHandler(controller.getAttachmentUrl),
);

educationRouter.post(
  '/lessons/upload-url',
  authenticate,
  requireEducator,
  validate({ body: lessonUploadUrlRequestSchema }),
  asyncHandler(controller.createUploadUrl),
);
educationRouter.post(
  '/lessons',
  authenticate,
  requireEducator,
  validate({ body: lessonCreateSchema }),
  asyncHandler(controller.createLesson),
);
educationRouter.patch(
  '/lessons/:id',
  authenticate,
  requireEducator,
  validate({ body: lessonUpdateSchema }),
  asyncHandler(controller.updateLesson),
);
educationRouter.delete(
  '/lessons/:id',
  authenticate,
  requireEducator,
  asyncHandler(controller.deleteLesson),
);
