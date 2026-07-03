/**
 * Notification routes (ARCHITECTURE.md §8). All require a signed-in user.
 */

import { Router } from 'express';
import { registerPushTokenSchema } from '@sma/validators';
import { validate } from '@/shared/middleware/validate';
import { authenticate } from '@/shared/middleware/authenticate';
import { asyncHandler } from '@/shared/http/asyncHandler';
import * as controller from './notifications.controller';

export const notificationsRouter: Router = Router();

notificationsRouter.use(authenticate);

notificationsRouter.post(
  '/register-token',
  validate({ body: registerPushTokenSchema }),
  asyncHandler(controller.registerToken),
);
notificationsRouter.post('/test', asyncHandler(controller.sendTest));
