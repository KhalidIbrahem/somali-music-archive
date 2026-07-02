/**
 * Convert a ZodError into our `AppError` (400 VALIDATION_ERROR) with per-field
 * messages, so client forms can map errors back to inputs (ARCHITECTURE.md §12).
 */

import type { ZodError } from 'zod';
import type { FieldError } from '@sma/types';
import { AppError } from './AppError';

export function appErrorFromZod(error: ZodError): AppError {
  const fields: FieldError[] = error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  return new AppError(400, 'VALIDATION_ERROR', 'One or more fields are invalid', fields);
}
