/**
 * Auth API calls (ARCHITECTURE.md §12 AUTH).
 *
 * Every function unwraps the `ApiResponse<T>` envelope and throws on failure, so
 * callers (React Query mutations, the auth store) work with plain values/errors.
 */

import type { ApiResponse, AuthTokens, PublicUser } from '@sma/types';
import type { LoginInput, RegisterInput } from '@sma/validators';
import { apiClient } from './client';
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

export async function getMe(): Promise<PublicUser> {
  const res = await apiClient.get<ApiResponse<PublicUser>>('/users/me');
  return unwrap(res.data);
}
