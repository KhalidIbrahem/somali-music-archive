/**
 * Require a verified email (ARCHITECTURE.md §11 — "Email verification required
 * before full access"). Use AFTER `authenticate`. Applied to privileged actions
 * (e.g. contributing recordings) rather than to read-only browsing, so an
 * unverified user can still sign in and finish verifying.
 *
 * The verified flag comes from the access-token claim, so this costs no DB lookup;
 * because access tokens are short-lived, a freshly-verified user picks up full
 * access on their next token refresh.
 */

import type { NextFunction, Request, Response } from 'express';
import { AppError, unauthorized } from '@/shared/errors/AppError';

export function requireVerifiedEmail(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(unauthorized());
    return;
  }
  if (!req.user.emailVerified) {
    next(new AppError(403, 'AUTH_EMAIL_NOT_VERIFIED', 'Please verify your email to continue'));
    return;
  }
  next();
}
