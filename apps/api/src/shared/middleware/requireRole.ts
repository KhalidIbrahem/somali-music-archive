/**
 * Role-based authorization (ARCHITECTURE.md §11 Authorization).
 *
 * Use AFTER `authenticate`. Enforces the RBAC tiers listener < contributor < admin.
 * Authorization is enforced at the API layer, never only in the mobile UI — the
 * Record tab being hidden client-side is a convenience, not the security boundary.
 */

import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@sma/types';
import { forbidden, unauthorized } from '@/shared/errors/AppError';

export function requireRole(...allowed: readonly UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(unauthorized());
      return;
    }
    if (!allowed.includes(req.user.role)) {
      next(forbidden());
      return;
    }
    next();
  };
}

/** Convenience: contributor OR admin (the roles allowed to record/upload). */
export const requireContributor = requireRole('contributor', 'admin');

/** Convenience: admin only (dashboard/moderation endpoints). */
export const requireAdmin = requireRole('admin');
