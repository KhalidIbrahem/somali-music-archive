/**
 * MongoDB Recording model (SESSION "db-backed repositories", ARCHITECTURE.md §9).
 *
 * The content-metadata document. Fields mirror the in-memory RecordingDoc so the
 * Mongo-backed repository maps to the same PublicRecording wire shape. AI enrichment
 * lives in an `ai` subdocument; `timestamps` provides createdAt/updatedAt. The raw
 * audio never lives here — only its R2 `fileKey` (CLAUDE.md hard rule).
 */

import mongoose from 'mongoose';
import type { Model, Types } from 'mongoose';

// Mongoose is CommonJS: named value imports (`models`, `isValidObjectId`, …) are not
// real ESM exports and break under Node's ESM loader. Use the default export for
// values; types are erased so they can be imported normally.
const { Schema } = mongoose;

/** AI enrichment written by the internal callback (subset of RecordingAi). */
export interface RecordingAiFields {
  transcriptSomali?: string;
  transcriptEnglish?: string;
  isSinging?: boolean;
  pitchData?: unknown;
  dominantNotes?: string[];
  voicedFraction?: number;
  embeddingId?: string;
}

/** The shape of a lean Recording document read back from Mongo. */
export interface RecordingFields {
  _id: Types.ObjectId;
  humanId: string;
  fileKey: string;
  format: string;
  duration: number;
  fileSize: number;
  title: { somali: string };
  artistId: string;
  artistName: string;
  poetName?: string | null;
  genre: string;
  occasion?: string | null;
  region?: string | null;
  era?: string | null;
  instruments: string[];
  language: string;
  fieldNotes?: string | null;
  aiStatus: string;
  ai: RecordingAiFields;
  aiProcessedAt: Date | null;
  status: string;
  visibility: string;
  license: string;
  playCount: number;
  saveCount: number;
  sessionId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const aiSchema = new Schema<RecordingAiFields>(
  {
    transcriptSomali: String,
    transcriptEnglish: String,
    isSinging: Boolean,
    pitchData: Schema.Types.Mixed, // PitchPoint[] — stored opaquely, mapped on read
    dominantNotes: [String],
    voicedFraction: Number,
    embeddingId: String,
  },
  { _id: false },
);

const recordingSchema = new Schema<RecordingFields>(
  {
    humanId: { type: String, required: true, unique: true, index: true },
    fileKey: { type: String, required: true },
    format: { type: String, required: true },
    duration: { type: Number, default: 0 },
    fileSize: { type: Number, default: 0 },
    title: { somali: { type: String, default: '' } },
    artistId: { type: String, default: '' },
    artistName: { type: String, default: '' },
    poetName: { type: String, default: null },
    genre: { type: String, default: 'other', index: true },
    occasion: { type: String, default: null },
    region: { type: String, default: null, index: true },
    era: { type: String, default: null },
    instruments: { type: [String], default: [] },
    language: { type: String, default: 'so' },
    fieldNotes: { type: String, default: null },
    aiStatus: { type: String, default: 'pending' },
    ai: { type: aiSchema, default: () => ({}) },
    aiProcessedAt: { type: Date, default: null },
    // Only published recordings are public; the index serves the archive + moderation.
    status: { type: String, default: 'draft', index: true },
    visibility: { type: String, default: 'private' },
    license: { type: String, default: 'all-rights-reserved' },
    playCount: { type: Number, default: 0 },
    saveCount: { type: Number, default: 0 },
    sessionId: { type: String, default: '' },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'recordings' },
);

/** Reuse the compiled model across hot reloads / repeated imports. */
export const RecordingModel: Model<RecordingFields> =
  (mongoose.models['Recording'] as Model<RecordingFields> | undefined) ??
  mongoose.model<RecordingFields>('Recording', recordingSchema);
