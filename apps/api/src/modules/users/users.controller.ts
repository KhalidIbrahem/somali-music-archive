/**
 * User controllers (ARCHITECTURE.md §12 USERS).
 */

import type { Request, Response } from 'express';
import { sendSuccess } from '@/shared/http/respond';
import { unauthorized } from '@/shared/errors/AppError';
import { getCurrentUser } from '@/modules/auth/auth.service';
import { userRepository } from '@/modules/auth/user.repository';

export async function getMe(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  const user = await getCurrentUser(userRepository, req.user.id);
  sendSuccess(res, user);
}

export async function updateMe(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  // Phase 1: persist the validated patch (displayName/language/avatarUrl) via the
  // repository. For now, return the current profile so the contract is exercised.
  const user = await getCurrentUser(userRepository, req.user.id);
  sendSuccess(res, user);
}
