/**
 * Augment Express's `Request` with the authenticated principal set by the
 * `authenticate` middleware. Keeping it minimal (id + role) means handlers get
 * just enough for authorization without carrying the whole user object around.
 */

import type { UserRole } from '@sma/types';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: UserRole;
      };
    }
  }
}

export {};
