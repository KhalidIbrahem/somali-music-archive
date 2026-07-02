/**
 * AppError — the one error type route handlers throw for expected failures.
 *
 * It pairs an HTTP status with a machine-readable `ApiErrorCode` from the shared
 * contract (@sma/types), so the error handler can serialise it into the exact
 * `ApiResponse` envelope every client already understands (ARCHITECTURE.md §12).
 * Unknown/unexpected throwables become a generic 500 in the handler — details are
 * logged, never leaked (§11 — no PII/internals in responses).
 */

import type { ApiErrorCode, FieldError } from '@sma/types';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly fields: readonly FieldError[] | undefined;

  constructor(
    statusCode: number,
    code: ApiErrorCode,
    message: string,
    fields?: readonly FieldError[],
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.fields = fields;
  }
}

// ── Common factories ──────────────────────────────────────────────────────────

export const badRequest = (code: ApiErrorCode, message: string, fields?: readonly FieldError[]) =>
  new AppError(400, code, message, fields);

export const unauthorized = (code: ApiErrorCode = 'AUTH_INVALID_TOKEN', message = 'Unauthorized') =>
  new AppError(401, code, message);

export const forbidden = (message = 'You do not have access to this resource') =>
  new AppError(403, 'AUTH_FORBIDDEN', message);

export const notFound = (code: ApiErrorCode = 'NOT_FOUND', message = 'Not found') =>
  new AppError(404, code, message);

export const tooManyRequests = (message = 'Too many requests') =>
  new AppError(429, 'RATE_LIMITED', message);
