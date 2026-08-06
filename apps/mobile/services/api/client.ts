/**
 * Axios API client with auth interceptors (ARCHITECTURE.md §6, §8 auth flow).
 *
 * Responsibilities:
 *   • attach the Bearer access token to every request,
 *   • on a 401, transparently refresh the access token using the stored refresh
 *     token exactly once, then retry the original request (invisible to screens,
 *     ARCHITECTURE.md §8 step 5),
 *   • coalesce concurrent refreshes so a burst of 401s triggers a single refresh,
 *   • when refresh is impossible, clear the session and notify a registered
 *     handler so the app can route back to sign-in.
 *
 * Tokens are read/written ONLY through `secureStorage` (expo-secure-store),
 * never AsyncStorage (CONVENTIONS.md hard rule).
 *
 * The unauthorized handler is a decoupling seam: the store registers a callback
 * here (store → client), so this low-level module never imports the store and no
 * import cycle forms.
 */

import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import type { ApiResponse, AuthTokens } from '@sma/types';
import { config } from '@/constants/config';
import { secureStorage } from '@/services/storage/secureStorage';

/** Extends the request config with our one-shot retry flag. */
interface RetriableRequest extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: config.apiUrl,
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Unauthorized handler registration ─────────────────────────────────────────
let onUnauthorized: (() => void) | null = null;

/** Register a callback invoked when the session can no longer be refreshed. The
 * auth store registers `clearSession` here so a dead session logs the user out. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

// ── Request: attach access token ──────────────────────────────────────────────
apiClient.interceptors.request.use(async (request) => {
  const token = await secureStorage.getAccessToken();
  if (token) {
    request.headers.set('Authorization', `Bearer ${token}`);
  }
  return request;
});

// ── Shared refresh primitive (bare axios — skips these interceptors) ──────────
let refreshInFlight: Promise<AuthTokens | null> | null = null;

/** Exchange the stored refresh token for a fresh pair, persisting the result.
 * Returns null when no refresh token exists or the server rejects it. Concurrent
 * callers share a single in-flight request. */
export function refreshTokens(): Promise<AuthTokens | null> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(): Promise<AuthTokens | null> {
  const refreshToken = await secureStorage.getRefreshToken();
  if (!refreshToken) return null;
  try {
    const { data } = await axios.post<ApiResponse<AuthTokens>>(`${config.apiUrl}/auth/refresh`, {
      refreshToken,
    });
    if (!data.success) return null;
    await secureStorage.setTokens(data.data.accessToken, data.data.refreshToken);
    return data.data;
  } catch {
    return null;
  }
}

// ── Response: refresh-on-401, retry once ──────────────────────────────────────
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableRequest | undefined;
    const isAuthError = error.response?.status === 401;

    if (!original || !isAuthError || original._retry) {
      return Promise.reject(error);
    }
    original._retry = true;

    const tokens = await refreshTokens();
    if (!tokens) {
      await secureStorage.clear();
      onUnauthorized?.();
      return Promise.reject(error);
    }
    original.headers.set('Authorization', `Bearer ${tokens.accessToken}`);
    return apiClient(original);
  },
);
