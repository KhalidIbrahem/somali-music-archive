/**
 * Auth routes (ARCHITECTURE.md §12 AUTH). The strict `authLimiter` (5 attempts /
 * 15 min / IP, §11 Threat 2) guards the credential endpoints. Every input passes
 * through `validate` with the shared @sma/validators schemas (CONVENTIONS.md hard rule).
 */

import { Router } from 'express';
import {
  loginSchema,
  registerSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
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
  '/verify-email',
  validate({ body: verifyEmailSchema }),
  asyncHandler(controller.verifyEmail),
);

authRouter.post(
  '/forgot-password',
  authLimiter,
  validate({ body: forgotPasswordSchema }),
  asyncHandler(controller.forgotPassword),
);

authRouter.post(
  '/reset-password',
  authLimiter,
  validate({ body: resetPasswordSchema }),
  asyncHandler(controller.resetPassword),
);
