/**
 * Course routes (/api/v1/courses) — members-only reading + per-user progress
 * (the platform is invite-only; there is no public course surface).
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { courseLessonProgressSchema } from '@sma/validators';
import { validate } from '@/shared/middleware/validate';
import { authenticate } from '@/shared/middleware/authenticate';
import { asyncHandler } from '@/shared/http/asyncHandler';
import { sendSuccess } from '@/shared/http/respond';
import { unauthorized } from '@/shared/errors/AppError';
import { coursesService } from './courses.service';

export const coursesRouter: Router = Router();

coursesRouter.use(authenticate);

function userId(req: Request): string {
  if (!req.user) throw unauthorized();
  return req.user.id;
}

coursesRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await coursesService.listCourses(userId(req)));
  }),
);

coursesRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await coursesService.getCourse(userId(req), req.params['id'] ?? ''));
  }),
);

coursesRouter.post(
  '/:id/lessons/:lessonId/progress',
  validate({ body: courseLessonProgressSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { completed } = req.body as { completed: boolean };
    sendSuccess(
      res,
      await coursesService.setLessonProgress(
        userId(req),
        req.params['id'] ?? '',
        req.params['lessonId'] ?? '',
        completed,
      ),
    );
  }),
);
