/**
 * The API envelope and error taxonomy (ARCHITECTURE.md §12).
 *
 * EVERY endpoint returns `ApiResponse<T>`. Clients branch on `success` and get
 * a fully-typed `data` or a machine-readable `error.code`. Encoding the envelope
 * once here means the mobile app, web app, and integration tests all share the
 * exact same contract — a mismatch becomes a type error, not a production bug.
 */

/** Machine-readable error codes. Append-only; clients switch on these strings. */
export const API_ERROR_CODES = [
  // Auth
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_INVALID_TOKEN',
  'AUTH_TOKEN_EXPIRED',
  'AUTH_EMAIL_NOT_VERIFIED',
  'AUTH_EMAIL_TAKEN',
  'AUTH_ACCOUNT_LOCKED',
  'AUTH_FORBIDDEN',
  // Validation
  'VALIDATION_ERROR',
  // Resources
  'RECORDING_NOT_FOUND',
  'ARTIST_NOT_FOUND',
  'LESSON_NOT_FOUND',
  'USER_NOT_FOUND',
  // Rate limiting / abuse
  'RATE_LIMITED',
  // Billing
  'SUBSCRIPTION_REQUIRED',
  'PAYMENT_FAILED',
  // Generic
  'NOT_FOUND',
  'INTERNAL_ERROR',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Per-field validation detail, surfaced to forms. */
export interface FieldError {
  readonly path: string;
  readonly message: string;
}

export interface ApiError {
  readonly code: ApiErrorCode;
  readonly message: string;
  /** Present only for VALIDATION_ERROR — maps 1:1 to form fields. */
  readonly fields?: readonly FieldError[];
}

export interface ApiSuccess<T> {
  readonly success: true;
  readonly data: T;
}

export interface ApiFailure {
  readonly success: false;
  readonly error: ApiError;
}

/** The single response shape returned by every endpoint. */
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** Cursor/offset pagination envelope wrapping a page of results (§12). */
export interface Paginated<T> {
  readonly data: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly hasMore: boolean;
}

/** Common list query parameters accepted by paginated endpoints. */
export interface PaginationQuery {
  readonly page?: number;
  readonly limit?: number;
}

/** The auth payload returned by register/login/refresh (§12 AUTH). */
export interface AuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
}
