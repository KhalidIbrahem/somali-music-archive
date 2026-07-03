/**
 * Subscription routes (ARCHITECTURE.md §12 SUBSCRIPTIONS).
 *
 * `/plans` and `/webhook` are public (pricing page; Stripe callback). Status,
 * checkout, and cancel require a signed-in user. The webhook verifies Stripe's
 * signature against the raw body captured in app.ts — it must NOT go through the
 * JSON body validator.
 */

import { Router } from 'express';
import { checkoutSchema } from '@sma/validators';
import { validate } from '@/shared/middleware/validate';
import { authenticate } from '@/shared/middleware/authenticate';
import { asyncHandler } from '@/shared/http/asyncHandler';
import * as controller from './subscriptions.controller';

export const subscriptionsRouter: Router = Router();

subscriptionsRouter.get('/plans', asyncHandler(controller.getPlans));
subscriptionsRouter.post('/webhook', asyncHandler(controller.webhook));

subscriptionsRouter.get('/status', authenticate, asyncHandler(controller.getStatus));
subscriptionsRouter.post(
  '/checkout',
  authenticate,
  validate({ body: checkoutSchema }),
  asyncHandler(controller.checkout),
);
subscriptionsRouter.post('/cancel', authenticate, asyncHandler(controller.cancel));
