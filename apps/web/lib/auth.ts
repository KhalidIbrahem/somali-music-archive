/**
 * Session token storage for the web app — one slot shared by general members and
 * admins. The access token (15 min) plus the rotating refresh token (30 days)
 * live in localStorage and are used by lib/api: the access token on every call,
 * the refresh token to transparently renew an expired session. Guarded for SSR
 * (no `window` on the server).
 *
 * Components that must react to sign-in/sign-out (header menu, account page)
 * subscribe via `subscribeToken` + `useSyncExternalStore`: `setSession`/
 * `clearSession` notify same-tab listeners with a custom event, and the native
 * `storage` event covers other tabs.
 */

import type { AuthTokens } from '@sma/types';

// Key kept from the original admin-only implementation so existing sessions
// survive the rename of this module's scope.
const TOKEN_KEY = 'sma.admin.accessToken';
const REFRESH_KEY = 'sma.refreshToken';

/** Same-tab change notification — `storage` events only fire in OTHER tabs. */
const TOKEN_EVENT = 'sma:token-changed';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

/** Store a full session (login/register/refresh all return a rotated pair). */
export function setSession(tokens: AuthTokens): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, tokens.accessToken);
  window.localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  window.dispatchEvent(new Event(TOKEN_EVENT));
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
  window.dispatchEvent(new Event(TOKEN_EVENT));
}

/** Subscribe to session changes in this tab and others. Returns an unsubscriber. */
export function subscribeToken(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(TOKEN_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(TOKEN_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}
