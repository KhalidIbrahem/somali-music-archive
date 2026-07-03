/**
 * Augment Express's `Request` with the authenticated principal set by the
 * `authenticate` middleware. Carries just enough for authorization and logout:
 * the user id + role, the verified-email flag, and the token's jti/exp (so logout
 * can blacklist this exact token for its remaining lifetime).
 */

import type { UserRole } from '@sma/types';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: UserRole;
        emailVerified: boolean;
        /** Access-token id, for revocation on logout. */
        jti: string;
        /** Access-token expiry (UNIX seconds). */
        exp: number;
      };
    }
  }
}

export {};
