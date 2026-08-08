/**
 * MongoDB TeachingLesson model (SESSION "teaching", ARCHITECTURE.md §9 —
 * authored lesson content is a content document, so it lives in MongoDB beside
 * recordings). Attachment bytes never live here — only their R2 `fileKey`s
 * (CONVENTIONS.md hard rule).
 */

import mongoose from 'mongoose';
import type { Model, Types } from 'mongoose';

// Mongoose is CommonJS: named value imports break under Node's ESM loader —
// use the default export for values (same pattern as recording.model.ts).
const { Schema } = mongoose;

export interface LessonAttachmentFields {
  fileKey: string;
  name: string;
  contentType: string;
  sizeBytes?: number;
}

/** The shape of a lean TeachingLesson document read back from Mongo. */
export interface TeachingLessonFields {
  _id: Types.ObjectId;
  title: string;
  summary: string;
  body: string;
  track: string;
  attachments: LessonAttachmentFields[];
  authorId: string;
  authorName: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const attachmentSchema = new Schema<LessonAttachmentFields>(
  {
    fileKey: { type: String, required: true },
    name: { type: String, required: true },
    contentType: { type: String, required: true },
    sizeBytes: { type: Number },
  },
  { _id: false },
);

const teachingLessonSchema = new Schema<TeachingLessonFields>(
  {
    title: { type: String, required: true },
    summary: { type: String, default: '' },
    body: { type: String, default: '' },
    track: { type: String, default: 'general', index: true },
    attachments: { type: [attachmentSchema], default: [] },
    authorId: { type: String, required: true, index: true },
    authorName: { type: String, required: true },
    status: { type: String, default: 'published' },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'teaching_lessons' },
);

// The public list filters status=published and sorts newest-first.
teachingLessonSchema.index({ status: 1, createdAt: -1 });

/** Reuse the compiled model across hot reloads / repeated imports. */
export const TeachingLessonModel: Model<TeachingLessonFields> =
  (mongoose.models['TeachingLesson'] as Model<TeachingLessonFields> | undefined) ??
  mongoose.model<TeachingLessonFields>('TeachingLesson', teachingLessonSchema);
