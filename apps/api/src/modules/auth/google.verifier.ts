/**
 * Google ID-token verification (SESSION "auth providers").
 *
 * The web app renders the Google Identity Services button, which yields a signed
 * JWT credential; this module verifies its signature and audience against our
 * OAuth client ID (google-auth-library fetches + caches Google's JWKS). The
 * service layer depends on the `GoogleIdentityVerifier` FUNCTION TYPE, so unit
 * tests inject a fake identity without any network or Google account.
 */

import { OAuth2Client } from 'google-auth-library';
import { env } from '@/config/env';
import { AppError, unauthorized } from '@/shared/errors/AppError';

/** What we trust from a verified Google credential. */
export interface GoogleIdentity {
  email: string;
  /** Google's own assertion that it verified this email's ownership. */
  emailVerified: boolean;
  name?: string;
  avatarUrl?: string;
}

export type GoogleIdentityVerifier = (credential: string) => Promise<GoogleIdentity>;

let client: OAuth2Client | null = null;

export const verifyGoogleCredential: GoogleIdentityVerifier = async (credential) => {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new AppError(
      503,
      'AUTH_PROVIDER_UNAVAILABLE',
      'Google sign-in is not configured on this server',
    );
  }
  client ??= new OAuth2Client(env.GOOGLE_CLIENT_ID);

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    throw unauthorized('AUTH_INVALID_TOKEN', 'Google sign-in could not be verified');
  }
  if (!payload?.email) {
    throw unauthorized('AUTH_INVALID_TOKEN', 'Google account did not provide an email');
  }
  return {
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified === true,
    ...(payload.name ? { name: payload.name } : {}),
    ...(payload.picture ? { avatarUrl: payload.picture } : {}),
  };
};
