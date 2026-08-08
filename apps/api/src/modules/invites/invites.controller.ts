/**
 * Invite controllers — thin adapters over `invitesService` (admin only).
 */

import type { Request, Response } from 'express';
import type { InviteCreateInput } from '@sma/validators';
import { sendSuccess } from '@/shared/http/respond';
import { unauthorized } from '@/shared/errors/AppError';
import { invitesService } from './invites.service';

export async function createInvite(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  const invite = await invitesService.createInvite(req.user.id, req.body as InviteCreateInput);
  sendSuccess(res, invite, 201);
}

export async function listInvites(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await invitesService.listInvites());
}

export async function revokeInvite(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await invitesService.revokeInvite(req.params['id'] ?? ''));
}
