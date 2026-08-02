/**
 * Library routes — the shelf of scanned music-sheet books (/api/v1/library).
 *
 * All endpoints require a signed-in user (reads are public-ish — auth still
 * required, matching recordings). Uploads use the presigned-R2 flow; documents
 * never pass through this API (CLAUDE.md hard rule).
 */

import { Router } from 'express';
import { bookCreateSchema, bookUploadUrlRequestSchema } from '@sma/validators';
import { validate } from '@/shared/middleware/validate';
import { authenticate } from '@/shared/middleware/authenticate';
import { asyncHandler } from '@/shared/http/asyncHandler';
import * as controller from './library.controller';

export const libraryRouter: Router = Router();

libraryRouter.use(authenticate);

libraryRouter.get('/books', asyncHandler(controller.listBooks));
libraryRouter.get('/books/:id/file', asyncHandler(controller.getBookFile));

libraryRouter.post(
  '/books/upload-url',
  validate({ body: bookUploadUrlRequestSchema }),
  asyncHandler(controller.createUploadUrl),
);
libraryRouter.post(
  '/books',
  validate({ body: bookCreateSchema }),
  asyncHandler(controller.createBook),
);
