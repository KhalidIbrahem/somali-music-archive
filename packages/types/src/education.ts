/**
 * Education types (SESSION "teaching") — lessons and teaching resources authored
 * by educators (e.g. an ethnomusicology professor uploading course material).
 *
 * Distinct from `lesson.ts`: that file models the app's own built-in curriculum
 * (modules with interactive blocks + per-learner progress). A TeachingLesson is
 * educator-authored content — a titled write-up with file attachments (readings,
 * slides, audio examples) stored in R2 under the `lessons/` prefix. Content
 * documents live in MongoDB; attachments never pass through Node (presigned
 * upload, CONVENTIONS.md hard rule).
 */

import type { IsoDateTimeString } from './common';

/** Curriculum placement of an authored lesson. `general` = not track-specific. */
export const TEACHING_TRACKS = ['general', 'beginner', 'intermediate', 'advanced'] as const;
export type TeachingTrack = (typeof TEACHING_TRACKS)[number];

/** Draft lessons are visible only to their author (and admins). */
export type TeachingLessonStatus = 'draft' | 'published';

/** File types an educator may attach: documents, page images, audio examples. */
export const LESSON_ATTACHMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'audio/mpeg',
  'audio/wav',
  'audio/mp4',
] as const;
export type LessonAttachmentContentType = (typeof LESSON_ATTACHMENT_CONTENT_TYPES)[number];

export interface LessonAttachment {
  /** Opaque R2 object key (UUID-based, `lessons/` prefix — never the original filename). */
  readonly fileKey: string;
  /** Display name shown to learners (the sanitized original filename). */
  readonly name: string;
  readonly contentType: LessonAttachmentContentType;
  readonly sizeBytes?: number;
}

/** An educator-authored lesson, as returned by the API. */
export interface TeachingLesson {
  readonly id: string;
  readonly title: string;
  /** One-paragraph description shown on the lesson list. */
  readonly summary: string;
  /** The lesson text (markdown-flavoured plain text; rendered as paragraphs). */
  readonly body: string;
  readonly track: TeachingTrack;
  readonly attachments: readonly LessonAttachment[];
  readonly authorId: string;
  /** Denormalised display-name snapshot (same pattern as Comment.authorName). */
  readonly authorName: string;
  readonly status: TeachingLessonStatus;
  readonly createdAt: IsoDateTimeString;
  readonly updatedAt: IsoDateTimeString;
}

/** Short-lived signed URL for one lesson attachment. */
export interface SignedAttachmentUrl {
  readonly url: string;
  readonly expiresAt: IsoDateTimeString;
}
