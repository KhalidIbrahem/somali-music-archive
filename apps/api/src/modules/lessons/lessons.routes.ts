/**
 * Lesson routes (ARCHITECTURE.md §12 LESSONS). All require a signed-in user.
 * Literal paths (/modules, /progress) are registered BEFORE the /:id param route
 * so they are matched first.
 */

import { Router } from 'express';
import { lessonProgressSchema } from '@sma/validators';
import { validate } from '@/shared/middleware/validate';
import { authenticate } from '@/shared/middleware/authenticate';
import { asyncHandler } from '@/shared/http/asyncHandler';
import * as controller from './lessons.controller';

export const lessonsRouter: Router = Router();

lessonsRouter.use(authenticate);

lessonsRouter.get('/modules', asyncHandler(controller.getModules));
lessonsRouter.get('/modules/:id', asyncHandler(controller.getModule));
lessonsRouter.get('/progress', asyncHandler(controller.getProgress));
lessonsRouter.post(
  '/:id/progress',
  validate({ body: lessonProgressSchema }),
  asyncHandler(controller.postProgress),
);
lessonsRouter.get('/:id', asyncHandler(controller.getLesson));
