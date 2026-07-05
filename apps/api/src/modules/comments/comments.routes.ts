/**
 * Comment routes (SESSION P4-05, ARCHITECTURE.md §16 Phase 4). All require a
 * signed-in user; deletion authorisation (author or admin) is in the service.
 */

import { Router } from 'express';
import { createCommentSchema, commentsQuerySchema } from '@sma/validators';
import { validate } from '@/shared/middleware/validate';
import { authenticate } from '@/shared/middleware/authenticate';
import { asyncHandler } from '@/shared/http/asyncHandler';
import * as controller from './comments.controller';

export const commentsRouter: Router = Router();

commentsRouter.use(authenticate);

commentsRouter.post('/', validate({ body: createCommentSchema }), asyncHandler(controller.create));
commentsRouter.get('/', validate({ query: commentsQuerySchema }), asyncHandler(controller.list));
commentsRouter.delete('/:id', asyncHandler(controller.remove));
