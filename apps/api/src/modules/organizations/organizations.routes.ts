/**
 * Organisation routes (SESSION P4-02, ARCHITECTURE.md §16 Phase 4).
 *
 * All endpoints require a signed-in user. Issuing a license is admin-only; joining
 * / leaving is any user; owner-only management (view/list/remove members) is
 * enforced in the service. Literal paths are registered before `/:id`.
 */

import { Router } from 'express';
import { createOrganizationSchema, joinOrganizationSchema } from '@sma/validators';
import { validate } from '@/shared/middleware/validate';
import { authenticate } from '@/shared/middleware/authenticate';
import { requireAdmin } from '@/shared/middleware/requireRole';
import { asyncHandler } from '@/shared/http/asyncHandler';
import * as controller from './organizations.controller';

export const organizationsRouter: Router = Router();

organizationsRouter.use(authenticate);

// Admin issues an institutional license.
organizationsRouter.post(
  '/',
  requireAdmin,
  validate({ body: createOrganizationSchema }),
  asyncHandler(controller.create),
);

// Membership (any signed-in user) — literal paths before /:id.
organizationsRouter.get('/mine', asyncHandler(controller.mine));
organizationsRouter.post(
  '/join',
  validate({ body: joinOrganizationSchema }),
  asyncHandler(controller.join),
);
organizationsRouter.post('/leave', asyncHandler(controller.leave));

// Owner-scoped management (ownership checked in the service).
organizationsRouter.get('/:id', asyncHandler(controller.getById));
organizationsRouter.get('/:id/members', asyncHandler(controller.listMembers));
organizationsRouter.delete('/:id/members/:userId', asyncHandler(controller.removeMember));
