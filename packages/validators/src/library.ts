/**
 * Library (music-sheet books) schemas — every /library API input validates here
 * (CLAUDE.md hard rule). The upload itself goes straight to R2 via a presigned
 * URL; these schemas gate the presign request and the shelf record.
 */

import { z } from 'zod';

/** Accepted book documents: PDF scans or single page images. */
export const BOOK_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

/** Scanned songbooks run heavy — allow up to 200 MB per document. */
export const MAX_BOOK_UPLOAD_BYTES = 200 * 1024 * 1024;

export const bookContentTypeSchema = z.enum(BOOK_CONTENT_TYPES);

/** Body of POST /library/books/upload-url — asks for a presigned R2 PUT. */
export const bookUploadUrlRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: bookContentTypeSchema,
  /** Optional client-reported size for a fast pre-check; authoritative size is R2's. */
  sizeBytes: z.number().int().positive().max(MAX_BOOK_UPLOAD_BYTES).optional(),
});

/** Body of POST /library/books — registers the uploaded document on the shelf. */
export const bookCreateSchema = z.object({
  fileKey: z.string().min(1),
  contentType: bookContentTypeSchema,
  title: z.string().trim().min(1, 'Title is required').max(300),
  author: z.string().trim().max(300).optional(),
  description: z.string().trim().max(2000).optional(),
});

export type BookContentTypeInput = z.infer<typeof bookContentTypeSchema>;
export type BookUploadUrlRequestInput = z.infer<typeof bookUploadUrlRequestSchema>;
export type BookCreateInput = z.infer<typeof bookCreateSchema>;
