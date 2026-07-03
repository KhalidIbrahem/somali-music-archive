/**
 * Subscription controllers (ARCHITECTURE.md §12 SUBSCRIPTIONS).
 */

import type { Request, Response } from 'express';
import type { CheckoutInput } from '@sma/validators';
import { sendSuccess } from '@/shared/http/respond';
import { badRequest, unauthorized } from '@/shared/errors/AppError';
import { subscriptionsService } from './subscriptions.service';

export async function getPlans(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, subscriptionsService.getPlans());
}

export async function getStatus(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  sendSuccess(res, await subscriptionsService.getStatus(req.user.id));
}

export async function checkout(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  const result = await subscriptionsService.createCheckout(req.user.id, req.body as CheckoutInput);
  sendSuccess(res, result);
}

export async function cancel(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  sendSuccess(res, await subscriptionsService.cancel(req.user.id));
}

export async function webhook(req: Request, res: Response): Promise<void> {
  const signature = req.headers['stripe-signature'];
  // Verify against the RAW body captured in app.ts (JSON parsing mangles the bytes
  // Stripe signed). Falls back to the parsed body for the fake gateway in dev/test.
  const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body));
  try {
    await subscriptionsService.processWebhook(raw, typeof signature === 'string' ? signature : '');
  } catch {
    throw badRequest('VALIDATION_ERROR', 'Invalid webhook payload or signature');
  }
  sendSuccess(res, { received: true });
}
