/**
 * Typed fetch wrapper to the backend API for the admin dashboard. Unwraps the
 * shared `ApiResponse<T>` envelope (@sma/types) and attaches the admin bearer token.
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
  LibraryBook,
  OrganizationMemberView,
  Paginated,
  PublicOrganization,
  PublicRecording,
  PublicUser,
  RecordingStatus,
  RecordingVisibility,
  SignedBookUrl,
} from '@sma/types';
import type { BookCreateInput, CreateOrganizationInput, RegisterInput } from '@sma/validators';
import { getToken } from './auth';

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

async function apiFetch<T>(path: string, init?: RequestInit, auth = true): Promise<T> {
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
 * PUT the document bytes straight to R2 (never through our API — CLAUDE.md).
 * Plain fetch on purpose: no auth header, and the Content-Type must match the
 * one the URL was presigned for.
 */
export async function uploadFileToR2(
  uploadUrl: string,
  file: File,
  contentType: BookContentType,
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

// ── AI music generation (provider-agnostic proxy; engines are backend detail) ─

/** Submit a generation job. The response may already be terminal (sync providers). */
export function requestGeneration(input: GenerationRequest): Promise<GenerationJob> {
  return apiFetch<GenerationJob>('/generate', { method: 'POST', body: JSON.stringify(input) });
}

/** Poll a generation job until `state` is `succeeded` or `failed` (≥3s apart). */
export function getGenerationJob(id: string): Promise<GenerationJob> {
  return apiFetch<GenerationJob>(`/generate/${id}`);
}
