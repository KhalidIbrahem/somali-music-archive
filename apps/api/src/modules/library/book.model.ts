/**
 * MongoDB LibraryBook model (SESSION "teaching" durability fix).
 *
 * The shelf metadata for scanned music-sheet books. Files themselves live in R2
 * (only the `fileKey` is stored — CONVENTIONS.md hard rule). Until this model,
 * shelf metadata was in-memory only: on serverless every cold start emptied the
 * shelf while the uploaded files lived on in R2 (CONTEXT.md Aug 6 open flag).
 */

import mongoose from 'mongoose';
import type { Model, Types } from 'mongoose';

// Mongoose is CommonJS — default-export values only (see recording.model.ts).
const { Schema } = mongoose;

/** The shape of a lean LibraryBook document read back from Mongo. */
export interface LibraryBookFields {
  _id: Types.ObjectId;
  title: string;
  author: string | null;
  description: string | null;
  contentType: string;
  fileKey: string;
  uploadedBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const libraryBookSchema = new Schema<LibraryBookFields>(
  {
    title: { type: String, required: true },
    author: { type: String, default: null },
    description: { type: String, default: null },
    contentType: { type: String, required: true },
    fileKey: { type: String, required: true },
    uploadedBy: { type: String, required: true, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'library_books' },
);

// The shelf lists live books newest-first.
libraryBookSchema.index({ deletedAt: 1, createdAt: -1 });

/** Reuse the compiled model across hot reloads / repeated imports. */
export const LibraryBookModel: Model<LibraryBookFields> =
  (mongoose.models['LibraryBook'] as Model<LibraryBookFields> | undefined) ??
  mongoose.model<LibraryBookFields>('LibraryBook', libraryBookSchema);
