/**
 * Auth API calls (ARCHITECTURE.md §12 AUTH).
 *
 * Every function unwraps the `ApiResponse<T>` envelope and throws a typed
 * `ApiRequestError` on failure, so callers (the auth store, screens) work with
 * plain values and machine-readable error codes.
 */

import type { ApiResponse, AuthTokens, PublicUser } from '@sma/types';
import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  VerifyEmailInput,
} from '@sma/validators';
import { apiClient, refreshTokens } from './client';
import { unwrap } from './unwrap';

/** Shape returned by register/login: the user plus a fresh token pair. */
export type AuthResult = { readonly user: PublicUser } & AuthTokens;

export async function register(input: RegisterInput): Promise<AuthResult> {
  const res = await apiClient.post<ApiResponse<AuthResult>>('/auth/register', input);
  return unwrap(res.data);
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const res = await apiClient.post<ApiResponse<AuthResult>>('/auth/login', input);
  return unwrap(res.data);
}

export async function logout(): Promise<void> {
  await apiClient.post<ApiResponse<{ success: true }>>('/auth/logout');
}

/**
 * Exchange the stored refresh token for a fresh access/refresh pair. Delegates to
 * the client's shared refresh primitive (which persists to secure storage and
 * de-duplicates concurrent calls). Throws if the session can no longer refresh.
 */
export async function refreshToken(): Promise<AuthTokens> {
  const tokens = await refreshTokens();
  if (!tokens) {
    throw new Error('Session expired — please sign in again.');
  }
  return tokens;
}

export async function forgotPassword(input: ForgotPasswordInput): Promise<void> {
  // The API always responds success to avoid leaking which emails are registered
  // (§11 — no account enumeration). We still surface transport errors to callers.
  await apiClient.post<ApiResponse<{ success: true }>>('/auth/forgot-password', input);
}

export async function verifyEmail(input: VerifyEmailInput): Promise<void> {
  await apiClient.post<ApiResponse<{ success: true }>>('/auth/verify-email', input);
}

export async function getMe(): Promise<PublicUser> {
  const res = await apiClient.get<ApiResponse<PublicUser>>('/users/me');
  return unwrap(res.data);
}
