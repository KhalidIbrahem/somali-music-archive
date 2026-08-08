/**
 * Typed fetch wrapper to the backend API. Unwraps the shared `ApiResponse<T>`
 * envelope (@sma/types), attaches the bearer token, and transparently renews an
 * expired access token with the stored refresh token (single-flight, one retry)
 * so a signed-in member stays signed in across the 15-minute access window.
 */

import type {
  ApiErrorCode,
  ApiResponse,
  AuthTokens,
  BookContentType,
  CreatedOrganization,
  FieldError,
  GenerationJob,
  GenerationRequest,
  InviteCodeView,
  LessonAttachmentContentType,
  LibraryBook,
  OrganizationMemberView,
  Paginated,
  PublicOrganization,
  PublicRecording,
  PublicUser,
  RecordingStatus,
  RecordingVisibility,
  SignedAttachmentUrl,
  SignedBookUrl,
  TeachingLesson,
} from '@sma/types';
import type {
  BookCreateInput,
  CreateOrganizationInput,
  InviteCreateInput,
  LessonCreateInput,
  LessonUpdateInput,
  RegisterInput,
  UpdateProfileInput,
} from '@sma/validators';
import { clearSession, getRefreshToken, getToken, setSession } from './auth';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1';

/** Server codes plus the one failure only the client can observe: no response at all. */
type ClientErrorCode = ApiErrorCode | 'NETWORK_ERROR';

const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Check your connection and try again.';

export class ApiError extends Error {
  readonly code: ClientErrorCode;
  /** Per-field validation errors (VALIDATION_ERROR responses) — path + message,
   *  so forms can attach each message to its input instead of showing only the
   *  generic envelope line. */
  readonly fields?: readonly FieldError[];
  constructor(code: ClientErrorCode, message: string, fields?: readonly FieldError[]) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    if (fields !== undefined) this.fields = fields;
  }
}

async function rawFetch<T>(path: string, init: RequestInit | undefined, auth: boolean): Promise<T> {
  const token = auth ? getToken() : null;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    // fetch rejects only on network-level failure (server down, DNS, CORS).
    throw new ApiError('NETWORK_ERROR', NETWORK_ERROR_MESSAGE);
  }
  let body: ApiResponse<T>;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError('INTERNAL_ERROR', `Server error (${res.status})`);
  }
  if (!body.success) {
    throw new ApiError(body.error.code, body.error.message, body.error.fields);
  }
  return body.data;
}

/** Single-flight refresh: concurrent 401s share one /auth/refresh call. */
let refreshInFlight: Promise<boolean> | null = null;

/** Trade the stored refresh token for a new pair. False → session is dead. */
function tryRefreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    try {
      const tokens = await rawFetch<AuthTokens>(
        '/auth/refresh',
        { method: 'POST', body: JSON.stringify({ refreshToken }) },
        false,
      );
      setSession(tokens);
      return true;
    } catch {
      // Rotated-out, revoked, or expired: the member must sign in again.
      clearSession();
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function apiFetch<T>(path: string, init?: RequestInit, auth = true): Promise<T> {
  try {
    return await rawFetch<T>(path, init, auth);
  } catch (err) {
    // An expired access token is renewable — refresh once and replay the call.
    if (auth && err instanceof ApiError && err.code === 'AUTH_TOKEN_EXPIRED') {
      const renewed = await tryRefreshSession();
      if (renewed) return rawFetch<T>(path, init, auth);
    }
    throw err;
  }
}

export type AuthResult = { user: PublicUser } & AuthTokens;

/** Sign in with an email OR an E.164 phone number in one identifier field. */
export function login(identifier: string, password: string): Promise<AuthResult> {
  return apiFetch<AuthResult>(
    '/auth/login',
    { method: 'POST', body: JSON.stringify({ identifier, password }) },
    false,
  );
}

/** Sign in/up with a Google Identity Services credential (POST /auth/google). */
export function loginWithGoogle(credential: string): Promise<AuthResult> {
  return apiFetch<AuthResult>(
    '/auth/google',
    { method: 'POST', body: JSON.stringify({ credential }) },
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

/** Revoke this session server-side (blacklists the access token's jti and all
 * refresh tokens). The caller clears local storage regardless of the outcome. */
export function logout(): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>('/auth/logout', { method: 'POST' });
}

export function getMe(): Promise<PublicUser> {
  return apiFetch<PublicUser>('/users/me');
}

/** PATCH /users/me — update the caller's own profile (validated server-side). */
export function updateMyProfile(patch: UpdateProfileInput): Promise<PublicUser> {
  return apiFetch<PublicUser>('/users/me', { method: 'PATCH', body: JSON.stringify(patch) });
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

// ── Invites + members (SESSION "private access"; admin only) ──────────────────

/** Mint an invite code (POST /invites). */
export function createInvite(input: InviteCreateInput): Promise<InviteCodeView> {
  return apiFetch<InviteCodeView>('/invites', { method: 'POST', body: JSON.stringify(input) });
}

/** Every code ever minted, with usage + who redeemed it. */
export function listInvites(): Promise<InviteCodeView[]> {
  return apiFetch<InviteCodeView[]>('/invites');
}

export function revokeInvite(id: string): Promise<InviteCodeView> {
  return apiFetch<InviteCodeView>(`/invites/${id}/revoke`, { method: 'POST' });
}

/** Paginated member list with optional search (GET /users, admin). */
export function listUsers(params: { page?: number; q?: string }): Promise<Paginated<PublicUser>> {
  const search = new URLSearchParams();
  if (params.page !== undefined) search.set('page', String(params.page));
  if (params.q !== undefined && params.q !== '') search.set('q', params.q);
  const query = search.toString();
  return apiFetch<Paginated<PublicUser>>(`/users${query ? `?${query}` : ''}`);
}

/** Remove a member (DELETE /users/:id, admin — soft delete server-side). */
export function removeUser(id: string): Promise<{ removed: boolean }> {
  return apiFetch<{ removed: boolean }>(`/users/${id}`, { method: 'DELETE' });
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

// ── Library — scanned books of Somali music sheets (presigned-R2 upload) ──────

export interface BookPresign {
  uploadUrl: string;
  fileKey: string;
  expiresAt: string;
}

/** Ask the API for a presigned R2 PUT for a book document. */
export function requestBookUploadUrl(input: {
  filename: string;
  contentType: BookContentType;
  sizeBytes?: number;
}): Promise<BookPresign> {
  return apiFetch<BookPresign>('/library/books/upload-url', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * PUT the document bytes straight to R2 (never through our API — CONVENTIONS.md).
 * Plain fetch on purpose: no auth header, and the Content-Type must match the
 * one the URL was presigned for. Shared by library books and lesson attachments.
 */
export async function uploadFileToR2(
  uploadUrl: string,
  file: File,
  contentType: BookContentType | LessonAttachmentContentType,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: file,
    });
  } catch {
    // Distinct from the API's network message: this leg goes browser→storage,
    // and a CORS/connectivity failure here is a storage-side problem, not an
    // API outage. (R2 bucket CORS is managed by scripts/r2-cors.mjs.)
    throw new ApiError(
      'NETWORK_ERROR',
      'The upload could not reach storage. Check your connection and try again.',
    );
  }
  if (!res.ok) {
    throw new ApiError('INTERNAL_ERROR', `Storage upload failed (${res.status})`);
  }
}

/** Register the uploaded document on the library shelf. */
export function createBook(input: BookCreateInput): Promise<LibraryBook> {
  return apiFetch<LibraryBook>('/library/books', { method: 'POST', body: JSON.stringify(input) });
}

export function listBooks(): Promise<LibraryBook[]> {
  return apiFetch<LibraryBook[]>('/library/books');
}

/** Short-lived signed read URL for a book (opens the PDF/scan). */
export function getBookFileUrl(id: string): Promise<SignedBookUrl> {
  return apiFetch<SignedBookUrl>(`/library/books/${id}/file`);
}

// ── Education — educator-authored lessons/resources (presigned-R2 attachments) ─

export interface LessonPresign {
  uploadUrl: string;
  fileKey: string;
  expiresAt: string;
}

/** Published lessons. Members-only since the platform went invite-only. */
export function listTeachingLessons(): Promise<TeachingLesson[]> {
  return apiFetch<TeachingLesson[]>('/education/lessons');
}

/** One lesson. Sends the token when present so authors can open their drafts. */
export function getTeachingLesson(id: string): Promise<TeachingLesson> {
  return apiFetch<TeachingLesson>(`/education/lessons/${id}`);
}

/** The signed-in educator's own lessons, drafts included. */
export function listMyTeachingLessons(): Promise<TeachingLesson[]> {
  return apiFetch<TeachingLesson[]>('/education/lessons/mine');
}

/** Ask the API for a presigned R2 PUT for a lesson attachment (educator only). */
export function requestLessonUploadUrl(input: {
  filename: string;
  contentType: LessonAttachmentContentType;
  sizeBytes?: number;
}): Promise<LessonPresign> {
  return apiFetch<LessonPresign>('/education/lessons/upload-url', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function createTeachingLesson(input: LessonCreateInput): Promise<TeachingLesson> {
  return apiFetch<TeachingLesson>('/education/lessons', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateTeachingLesson(
  id: string,
  patch: LessonUpdateInput,
): Promise<TeachingLesson> {
  return apiFetch<TeachingLesson>(`/education/lessons/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteTeachingLesson(id: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/education/lessons/${id}`, { method: 'DELETE' });
}

/** Short-lived signed read URL for one attachment of a lesson. */
export function getLessonAttachmentUrl(id: string, fileKey: string): Promise<SignedAttachmentUrl> {
  return apiFetch<SignedAttachmentUrl>(
    `/education/lessons/${id}/file?key=${encodeURIComponent(fileKey)}`,
  );
}

// ── AI music generation (provider-agnostic proxy; engines are backend detail) ─

/** Submit a generation job. The response may already be terminal (sync providers). */
export function requestGeneration(input: GenerationRequest): Promise<GenerationJob> {
  return apiFetch<GenerationJob>('/generate', { method: 'POST', body: JSON.stringify(input) });
}

/** Poll a generation job until `state` is `succeeded` or `failed` (≥3s apart). */
export function getGenerationJob(id: string): Promise<GenerationJob> {
  return apiFetch<GenerationJob>(`/generate/${id}`);
}
