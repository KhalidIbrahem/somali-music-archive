/**
 * Augment Express's `Request` with the authenticated principal set by the
 * `authenticate` middleware. Carries just enough for authorization and logout:
 * the user id + role, the verified-email flag, and the token's jti/exp (so logout
 * can blacklist this exact token for its remaining lifetime).
 */

import type { ApiKeyPlan, UserRole } from '@sma/types';

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
      /** The verified research API key (set by requireApiKey) — service-to-user auth. */
      apiKey?: {
        id: string;
        userId: string;
        plan: ApiKeyPlan;
        /** Requests allowed per hour, enforced by apiKeyRateLimit. */
        rateLimit: number;
      };
      /** Raw request body bytes, captured for Stripe webhook signature verification. */
      rawBody?: Buffer;
    }
  }
}

export {};
