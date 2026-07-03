/**
 * Notification controllers (ARCHITECTURE.md §8).
 */

import type { Request, Response } from 'express';
import type { RegisterPushTokenInput } from '@sma/validators';
import { sendSuccess } from '@/shared/http/respond';
import { unauthorized } from '@/shared/errors/AppError';
import { notificationsService } from './notifications.service';

export async function registerToken(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  await notificationsService.registerToken(req.user.id, req.body as RegisterPushTokenInput);
  sendSuccess(res, { registered: true });
}

/** Send a test push to the caller's own devices — for on-device verification. */
export async function sendTest(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  const count = await notificationsService.sendToUser(req.user.id, {
    title: 'Somali Music Archive',
    body: 'Push notifications are working. 🎶',
  });
  sendSuccess(res, { sent: count });
}
