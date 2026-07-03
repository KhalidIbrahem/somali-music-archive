/**
 * User controllers (ARCHITECTURE.md §12 USERS): profile + saved recordings.
 */

import type { Request, Response } from 'express';
import type { UpdateProfileInput } from '@sma/validators';
import { sendSuccess } from '@/shared/http/respond';
import { unauthorized } from '@/shared/errors/AppError';
import { usersService } from './users.service';

export async function getMe(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  sendSuccess(res, await usersService.getProfile(req.user.id));
}

export async function updateMe(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  const user = await usersService.updateProfile(req.user.id, req.body as UpdateProfileInput);
  sendSuccess(res, user);
}

export async function getSaved(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  sendSuccess(res, await usersService.listSaved(req.user.id));
}

export async function addSaved(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  await usersService.saveRecording(req.user.id, req.params['id'] ?? '');
  sendSuccess(res, { saved: true });
}

export async function removeSaved(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  await usersService.unsaveRecording(req.user.id, req.params['id'] ?? '');
  sendSuccess(res, { saved: false });
}
