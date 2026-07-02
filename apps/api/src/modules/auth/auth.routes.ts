/**
 * Auth routes (ARCHITECTURE.md §12 AUTH). The strict `authLimiter` guards the
 * credential endpoints (§11 Threat 2). Every input passes through `validate` with
 * the shared @sma/validators schemas (CLAUDE.md hard rule).
 */

import { Router } from 'express';
import {
  loginSchema,
  registerSchema,
  refreshSchema,
  forgotPasswordSchema,
} from '@sma/validators';
import { validate } from '@/shared/middleware/validate';
import { authenticate } from '@/shared/middleware/authenticate';
import { authLimiter } from '@/shared/middleware/rateLimit';
import { asyncHandler } from '@/shared/http/asyncHandler';
import * as controller from './auth.controller';

export const authRouter: Router = Router();

authRouter.post(
  '/register',
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(controller.register),
);

authRouter.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(controller.login),
);

authRouter.post('/refresh', validate({ body: refreshSchema }), asyncHandler(controller.refresh));

authRouter.post('/logout', authenticate, asyncHandler(controller.logout));

authRouter.post(
  '/forgot-password',
  authLimiter,
  validate({ body: forgotPasswordSchema }),
  asyncHandler(controller.forgotPassword),
);
