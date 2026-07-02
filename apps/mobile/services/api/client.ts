/**
 * Axios API client with auth interceptors (ARCHITECTURE.md §6, §8 auth flow).
 *
 * Responsibilities:
 *   • attach the Bearer access token to every request,
 *   • on a 401, transparently refresh the access token using the stored refresh
 *     token exactly once, then retry the original request,
 *   • coalesce concurrent refreshes so a burst of 401s triggers a single refresh.
 *
 * The token refresh flow is invisible to screens (ARCHITECTURE.md §8 step 5).
 */

import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';
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

// ── Request: attach access token ──────────────────────────────────────────────
apiClient.interceptors.request.use(async (request) => {
  const token = await secureStorage.getAccessToken();
  if (token) {
    request.headers.set('Authorization', `Bearer ${token}`);
  }
  return request;
});

// ── Response: refresh-on-401, retry once, de-duplicated ───────────────────────
let refreshInFlight: Promise<AuthTokens | null> | null = null;

async function refreshTokens(): Promise<AuthTokens | null> {
  const refreshToken = await secureStorage.getRefreshToken();
  if (!refreshToken) return null;
  try {
    // Bare axios (not apiClient) so this call skips the auth interceptors.
    const { data } = await axios.post<ApiResponse<AuthTokens>>(
      `${config.apiUrl}/auth/refresh`,
      { refreshToken },
    );
    if (!data.success) return null;
    await secureStorage.setTokens(data.data.accessToken, data.data.refreshToken);
    return data.data;
  } catch {
    return null;
  }
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableRequest | undefined;
    const isAuthError = error.response?.status === 401;

    if (!original || !isAuthError || original._retry) {
      return Promise.reject(error);
    }
    original._retry = true;

    // Coalesce concurrent refreshes into one network call.
    refreshInFlight ??= refreshTokens().finally(() => {
      refreshInFlight = null;
    });
    const tokens = await refreshInFlight;

    if (!tokens) {
      await secureStorage.clear();
      return Promise.reject(error);
    }
    original.headers.set('Authorization', `Bearer ${tokens.accessToken}`);
    return apiClient(original);
  },
);
