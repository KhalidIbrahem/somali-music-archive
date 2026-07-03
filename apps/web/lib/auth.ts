/**
 * Admin session token storage for the web dashboard. The access token lives in
 * localStorage (admin desktop context) and is attached to API calls in lib/api.
 * Guarded for SSR (no `window` on the server).
 */

const TOKEN_KEY = 'sma.admin.accessToken';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window !== 'undefined') window.localStorage.removeItem(TOKEN_KEY);
}
