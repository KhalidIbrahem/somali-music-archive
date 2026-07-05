/**
 * Typed fetch wrapper to the backend API for the admin dashboard. Unwraps the
 * shared `ApiResponse<T>` envelope (@sma/types) and attaches the admin bearer token.
 */

import type {
  ApiResponse,
  AuthTokens,
  CreatedOrganization,
  OrganizationMemberView,
  Paginated,
  PublicOrganization,
  PublicRecording,
  PublicUser,
  RecordingStatus,
  RecordingVisibility,
} from '@sma/types';
import type { CreateOrganizationInput, RegisterInput } from '@sma/validators';
import { getToken } from './auth';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1';

export class ApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit, auth = true): Promise<T> {
  const token = auth ? getToken() : null;
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const body = (await res.json()) as ApiResponse<T>;
  if (!body.success) {
    throw new ApiError(body.error.code, body.error.message);
  }
  return body.data;
}

export type AuthResult = { user: PublicUser } & AuthTokens;

export function login(email: string, password: string): Promise<AuthResult> {
  return apiFetch<AuthResult>(
    '/auth/login',
    { method: 'POST', body: JSON.stringify({ email, password }) },
    false,
  );
}

/** Create an account (POST /auth/register). Validated server-side by registerSchema. */
export function register(input: RegisterInput): Promise<AuthResult> {
  return apiFetch<AuthResult>(
    '/auth/register',
    { method: 'POST', body: JSON.stringify(input) },
    false,
  );
}

export function getMe(): Promise<PublicUser> {
  return apiFetch<PublicUser>('/users/me');
}

export function listModeration(status?: RecordingStatus): Promise<Paginated<PublicRecording>> {
  const query = status ? `?status=${status}&limit=50` : '?limit=50';
  return apiFetch<Paginated<PublicRecording>>(`/recordings/moderation${query}`);
}

export function updateRecording(
  id: string,
  patch: { status?: RecordingStatus; visibility?: RecordingVisibility },
): Promise<PublicRecording> {
  return apiFetch<PublicRecording>(`/recordings/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

// ── Institutional licenses (SESSION P4-03; admin manages the P4-02 orgs) ──────

/** Issue an institutional license (POST /organizations). Returns the key once. */
export function createOrganization(input: CreateOrganizationInput): Promise<CreatedOrganization> {
  return apiFetch<CreatedOrganization>('/organizations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getOrganization(id: string): Promise<PublicOrganization> {
  return apiFetch<PublicOrganization>(`/organizations/${id}`);
}

export function listOrgMembers(id: string): Promise<OrganizationMemberView[]> {
  return apiFetch<OrganizationMemberView[]>(`/organizations/${id}/members`);
}

export function removeOrgMember(id: string, userId: string): Promise<{ removed: boolean }> {
  return apiFetch<{ removed: boolean }>(`/organizations/${id}/members/${userId}`, {
    method: 'DELETE',
  });
}
