/**
 * Unwrap the shared `ApiResponse<T>` envelope into a plain value, or throw a
 * typed error. Centralised so every API call handles the success/failure split
 * identically and screens never inspect `response.success` by hand.
 */

import type { ApiResponse, ApiError } from '@sma/types';

/** An error carrying the machine-readable API error payload (§12). */
export class ApiRequestError extends Error {
  readonly code: ApiError['code'];
  readonly fields: ApiError['fields'];

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'ApiRequestError';
    this.code = error.code;
    this.fields = error.fields;
  }
}

export function unwrap<T>(response: ApiResponse<T>): T {
  if (response.success) {
    return response.data;
  }
  throw new ApiRequestError(response.error);
}
