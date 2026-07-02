/**
 * Response envelope helpers (ARCHITECTURE.md §12).
 *
 * Every handler returns through `sendSuccess` / `sendError` so the wire shape is
 * always `ApiResponse<T>` — `{ success, data }` or `{ success, error }`. Typing
 * `data` as `T` keeps handlers honest against the shared @sma/types contracts.
 */

import type { Response } from 'express';
import type { ApiError, ApiResponse, Paginated } from '@sma/types';

export function sendSuccess<T>(res: Response, data: T, status = 200): Response {
  const body: ApiResponse<T> = { success: true, data };
  return res.status(status).json(body);
}

export function sendPaginated<T>(res: Response, page: Paginated<T>, status = 200): Response {
  return sendSuccess(res, page, status);
}

export function sendError(res: Response, status: number, error: ApiError): Response {
  const body: ApiResponse<never> = { success: false, error };
  return res.status(status).json(body);
}
