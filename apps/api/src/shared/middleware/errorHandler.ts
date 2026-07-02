/**
 * Central error handler + 404 handler (ARCHITECTURE.md §12, §11).
 *
 * Turns every failure into the standard `ApiResponse` envelope:
 *   • AppError  → its status + machine-readable code (+ field errors),
 *   • ZodError  → 400 VALIDATION_ERROR,
 *   • anything else → 500 INTERNAL_ERROR, with the real cause LOGGED, never sent
 *     to the client (no internals/PII leak).
 */

import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '@/shared/errors/AppError';
import { appErrorFromZod } from '@/shared/errors/fromZod';
import { sendError } from '@/shared/http/respond';
import { logger } from '@/shared/logger';

/** 404 for any route that did not match. Registered after all routes. */
export function notFoundHandler(_req: Request, res: Response): void {
  sendError(res, 404, { code: 'NOT_FOUND', message: 'Resource not found' });
}

// Express identifies error handlers by their 4-arg signature — `next` must stay.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const appError = err instanceof ZodError ? appErrorFromZod(err) : err;

  if (appError instanceof AppError) {
    sendError(res, appError.statusCode, {
      code: appError.code,
      message: appError.message,
      ...(appError.fields ? { fields: appError.fields } : {}),
    });
    return;
  }

  // Unexpected: log the real error, return an opaque 500.
  logger.error({ err }, 'Unhandled error');
  sendError(res, 500, { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
}
