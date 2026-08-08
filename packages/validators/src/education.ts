/**
 * Education schemas (SESSION "teaching") — every /education API input validates
 * here (CONVENTIONS.md hard rule). Attachments upload straight to R2 via a
 * presigned URL; these schemas gate the presign request and the lesson record.
 */

import { z } from 'zod';
import { LESSON_ATTACHMENT_CONTENT_TYPES, TEACHING_TRACKS } from '@sma/types';

export const teachingTrackSchema = z.enum(TEACHING_TRACKS);
export const lessonAttachmentContentTypeSchema = z.enum(LESSON_ATTACHMENT_CONTENT_TYPES);

/** Audio examples and scans run heavy — allow up to 200 MB per attachment. */
export const MAX_LESSON_ATTACHMENT_BYTES = 200 * 1024 * 1024;
/** Cap attachments per lesson to keep a lesson a lesson, not a bulk drop. */
export const MAX_LESSON_ATTACHMENTS = 10;

/** Body of POST /education/lessons/upload-url — asks for a presigned R2 PUT. */
export const lessonUploadUrlRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: lessonAttachmentContentTypeSchema,
  /** Optional client-reported size for a fast pre-check; authoritative size is R2's. */
  sizeBytes: z.number().int().positive().max(MAX_LESSON_ATTACHMENT_BYTES).optional(),
});

const attachmentSchema = z.object({
  fileKey: z
    .string()
    .min(1)
    .max(300)
    // Only keys minted by the lessons presign endpoint — prevents a lesson from
    // claiming (and signing read URLs for) arbitrary objects elsewhere in the bucket.
    .regex(/^lessons\//, 'Invalid attachment key'),
  name: z.string().trim().min(1, 'Attachment name is required').max(160),
  contentType: lessonAttachmentContentTypeSchema,
  sizeBytes: z.number().int().positive().max(MAX_LESSON_ATTACHMENT_BYTES).optional(),
});

/** Body of POST /education/lessons — creates an authored lesson. */
export const lessonCreateSchema = z
  .object({
    title: z.string().trim().min(3, 'Title is too short').max(160),
    summary: z.string().trim().max(500).default(''),
    body: z.string().trim().max(50_000).default(''),
    track: teachingTrackSchema.default('general'),
    attachments: z.array(attachmentSchema).max(MAX_LESSON_ATTACHMENTS).default([]),
    status: z.enum(['draft', 'published']).default('published'),
  })
  // An empty lesson (no text AND no files) has nothing to teach — reject it.
  .refine((d) => d.body.length > 0 || d.summary.length > 0 || d.attachments.length > 0, {
    message: 'Add some lesson text or at least one attachment',
    path: ['body'],
  });

/** Body of PATCH /education/lessons/:id — partial update by the author (or admin). */
export const lessonUpdateSchema = z
  .object({
    title: z.string().trim().min(3, 'Title is too short').max(160).optional(),
    summary: z.string().trim().max(500).optional(),
    body: z.string().trim().max(50_000).optional(),
    track: teachingTrackSchema.optional(),
    attachments: z.array(attachmentSchema).max(MAX_LESSON_ATTACHMENTS).optional(),
    status: z.enum(['draft', 'published']).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to update' });

export type LessonUploadUrlRequestInput = z.infer<typeof lessonUploadUrlRequestSchema>;
export type LessonCreateInput = z.infer<typeof lessonCreateSchema>;
export type LessonUpdateInput = z.infer<typeof lessonUpdateSchema>;
