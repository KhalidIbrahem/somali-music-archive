/**
 * Invite routes (/api/v1/invites) — admin-only management of the codes that
 * gate registration (SESSION "private access"). Redemption itself happens
 * inside POST /auth/register, not here.
 */

import { Router } from 'express';
import { inviteCreateSchema } from '@sma/validators';
import { validate } from '@/shared/middleware/validate';
import { authenticate } from '@/shared/middleware/authenticate';
import { requireAdmin } from '@/shared/middleware/requireRole';
import { asyncHandler } from '@/shared/http/asyncHandler';
import * as controller from './invites.controller';

export const invitesRouter: Router = Router();

invitesRouter.use(authenticate, requireAdmin);

invitesRouter.get('/', asyncHandler(controller.listInvites));
invitesRouter.post(
  '/',
  validate({ body: inviteCreateSchema }),
  asyncHandler(controller.createInvite),
);
invitesRouter.post('/:id/revoke', asyncHandler(controller.revokeInvite));
