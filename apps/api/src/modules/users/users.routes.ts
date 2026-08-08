/**
 * User routes (ARCHITECTURE.md §12 USERS). All require a valid access token.
 */

import { Router } from 'express';
import { changeRoleSchema, listUsersQuerySchema, updateProfileSchema } from '@sma/validators';
import { validate } from '@/shared/middleware/validate';
import { authenticate } from '@/shared/middleware/authenticate';
import { requireAdmin } from '@/shared/middleware/requireRole';
import { asyncHandler } from '@/shared/http/asyncHandler';
import * as controller from './users.controller';

export const usersRouter: Router = Router();

usersRouter.use(authenticate);

usersRouter.get('/me', asyncHandler(controller.getMe));
usersRouter.patch(
  '/me',
  validate({ body: updateProfileSchema }),
  asyncHandler(controller.updateMe),
);

// Saved recordings (bookmarks).
usersRouter.get('/me/saved', asyncHandler(controller.getSaved));
usersRouter.post('/me/saved/:id', asyncHandler(controller.addSaved));
usersRouter.delete('/me/saved/:id', asyncHandler(controller.removeSaved));

// Admin: member list + role grants (e.g. promoting an educator).
usersRouter.get(
  '/',
  requireAdmin,
  validate({ query: listUsersQuerySchema }),
  asyncHandler(controller.listUsers),
);
usersRouter.patch(
  '/:id/role',
  requireAdmin,
  validate({ body: changeRoleSchema }),
  asyncHandler(controller.changeRole),
);
