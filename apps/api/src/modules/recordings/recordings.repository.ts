/**
 * Recording persistence (ARCHITECTURE.md §9 MongoDB Recording document).
 *
 * Interface-first (ADR-0005): Phase 2 provides a Mongoose-backed implementation
 * with the indexes from §14. This in-memory implementation makes the full upload
 * flow work and testable now: a draft is created when the presigned URL is issued,
 * then completed (metadata attached, AI status → processing) on upload-complete.
 *
 * Soft delete only — the bytes and the row are never destroyed (Principle 4).
 */

import { randomBytes } from 'node:crypto';
import type {
  AiStatus,
  AudioFormat,
  Paginated,
  PublicRecording,
  RecordingAi,
  RecordingLicense,
  RecordingStatus,
  RecordingVisibility,
} from '@sma/types';
import type { ContentLanguage, Genre, Instrument, Region } from '@sma/constants';
import type {
  ModerationQueryInput,
  RecordingCompleteMetadata,
  RecordingModerationInput,
  RecordingQueryInput,
} from '@sma/validators';
import { asIso, asObjectId } from '@/shared/brand';
import { sha256Hex } from '@/shared/crypto';
import { useDatabase } from '@/shared/db/driver';
import { MongoRecordingRepository } from './recordings.mongo.repository';

export interface RecordingDoc {
  id: string; // 24-hex ObjectId
  humanId: string;
  fileKey: string;
  format: AudioFormat;
  duration: number;
  fileSize: number;
  title: { somali: string };
  artistId: string;
  artistName: string;
  poetName: string | undefined;
  genre: Genre;
  occasion: string | undefined;
  region: Region | undefined;
  era: string | undefined;
  instruments: Instrument[];
  language: ContentLanguage;
  fieldNotes: string | undefined;
  aiStatus: AiStatus;
  /** AI enrichment written by the internal callback (transcripts, pitch, embedding). */
  aiExtras: RecordingAiPatch;
  aiProcessedAt: Date | null;
  status: RecordingStatus;
  visibility: RecordingVisibility;
  license: RecordingLicense;
  playCount: number;
  saveCount: number;
  sessionId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateDraftInput {
  fileKey: string;
  format: AudioFormat;
  sessionId: string;
}

/** The AI-result fields the internal callback may write (subset of RecordingAi). */
export type RecordingAiPatch = Pick<
  RecordingAi,
  | 'transcriptSomali'
  | 'transcriptEnglish'
  | 'isSinging'
  | 'pitchData'
  | 'dominantNotes'
  | 'voicedFraction'
  | 'embeddingId'
>;

export interface RecordingRepository {
  createDraft(input: CreateDraftInput): Promise<{ recordingId: string }>;
  complete(
    recordingId: string,
    metadata: RecordingCompleteMetadata,
  ): Promise<PublicRecording | null>;
  findById(id: string): Promise<PublicRecording | null>;
  /** Batch fetch by id — one query instead of N, for hydrating search/similar/
   * collection results (SESSION P4-07). Order is not guaranteed; callers re-order. */
  findByIds(ids: readonly string[]): Promise<PublicRecording[]>;
  list(query: RecordingQueryInput): Promise<Paginated<PublicRecording>>;
  /** Admin moderation queue — includes drafts/review, optionally status-filtered. */
  listForModeration(query: ModerationQueryInput): Promise<Paginated<PublicRecording>>;
  updateModeration(id: string, patch: RecordingModerationInput): Promise<PublicRecording | null>;
  /** Merge AI-pipeline results into the recording's ai document (internal callback). */
  updateAi(id: string, patch: RecordingAiPatch): Promise<PublicRecording | null>;
  getFileKey(id: string): Promise<string | null>;
  softDelete(id: string): Promise<void>;
}

/** Derive a stable placeholder artist id from the singer's name (until the artist
 * collection exists, the name is the identity). */
function artistIdFor(name: string): string {
  return sha256Hex(name.toLowerCase()).slice(0, 24);
}

/** Map an internal doc to the public wire shape (omits fileKey/session/etc.). */
function toPublicRecording(doc: RecordingDoc): PublicRecording {
  return {
    _id: asObjectId(doc.id),
    id: doc.humanId,
    duration: doc.duration,
    fileSize: doc.fileSize,
    format: doc.format,
    title: doc.title,
    artist: { id: asObjectId(doc.artistId), name: doc.artistName },
    genre: doc.genre,
    instruments: doc.instruments,
    language: doc.language,
    ai: {
      status: doc.aiStatus,
      ...doc.aiExtras,
      ...(doc.aiProcessedAt ? { processedAt: asIso(doc.aiProcessedAt) } : {}),
    },
    visibility: doc.visibility,
    license: doc.license,
    status: doc.status,
    playCount: doc.playCount,
    saveCount: doc.saveCount,
    createdAt: asIso(doc.createdAt),
    updatedAt: asIso(doc.updatedAt),
    ...(doc.poetName ? { poet: { name: doc.poetName } } : {}),
    ...(doc.occasion ? { occasion: doc.occasion } : {}),
    ...(doc.region ? { region: doc.region } : {}),
    ...(doc.era ? { era: doc.era } : {}),
  };
}

export class InMemoryRecordingRepository implements RecordingRepository {
  private readonly byId = new Map<string, RecordingDoc>();
  private seq = 0;

  async createDraft(input: CreateDraftInput): Promise<{ recordingId: string }> {
    const id = randomBytes(12).toString('hex'); // 24 hex, ObjectId-shaped
    const now = new Date();
    this.seq += 1;
    const datePart = now.toISOString().slice(0, 10);
    const doc: RecordingDoc = {
      id,
      humanId: `${datePart}-${String(this.seq).padStart(3, '0')}`,
      fileKey: input.fileKey,
      format: input.format,
      duration: 0,
      fileSize: 0,
      title: { somali: '' },
      artistId: '',
      artistName: '',
      poetName: undefined,
      genre: 'other',
      occasion: undefined,
      region: undefined,
      era: undefined,
      instruments: [],
      language: 'so',
      fieldNotes: undefined,
      aiStatus: 'pending',
      aiExtras: {},
      aiProcessedAt: null,
      status: 'draft',
      visibility: 'private',
      license: 'all-rights-reserved',
      playCount: 0,
      saveCount: 0,
      sessionId: input.sessionId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.byId.set(id, doc);
    return { recordingId: id };
  }

  async complete(
    recordingId: string,
    metadata: RecordingCompleteMetadata,
  ): Promise<PublicRecording | null> {
    const doc = this.byId.get(recordingId);
    if (!doc || doc.deletedAt) return null;
    doc.title = { somali: metadata.title.somali };
    doc.artistName = metadata.singerName;
    doc.artistId = artistIdFor(metadata.singerName);
    doc.poetName = metadata.poetName;
    doc.genre = metadata.genre;
    doc.occasion = metadata.occasion;
    doc.region = metadata.region;
    doc.era = metadata.era;
    doc.instruments = [...metadata.instruments];
    doc.fieldNotes = metadata.fieldNotes;
    doc.aiStatus = 'processing';
    doc.status = 'review'; // pending moderation before it is published
    doc.updatedAt = new Date();
    return toPublicRecording(doc);
  }

  /** Resolve a recording by its ObjectId key OR its human id (e.g. "2026-07-03-001"),
   * since clients navigate/save by the human id. */
  private resolve(idOrHumanId: string): RecordingDoc | undefined {
    return (
      this.byId.get(idOrHumanId) ?? [...this.byId.values()].find((d) => d.humanId === idOrHumanId)
    );
  }

  async findById(id: string): Promise<PublicRecording | null> {
    const doc = this.resolve(id);
    return doc && !doc.deletedAt ? toPublicRecording(doc) : null;
  }

  async findByIds(ids: readonly string[]): Promise<PublicRecording[]> {
    const out: PublicRecording[] = [];
    for (const id of ids) {
      const doc = this.resolve(id);
      if (doc && !doc.deletedAt) out.push(toPublicRecording(doc));
    }
    return out;
  }

  async list(query: RecordingQueryInput): Promise<Paginated<PublicRecording>> {
    // Only published recordings are public; drafts/review/archived are not listed.
    const all = [...this.byId.values()]
      .filter((d) => !d.deletedAt && d.status === 'published')
      .filter((d) => (query.genre ? d.genre === query.genre : true))
      .filter((d) => (query.region ? d.region === query.region : true))
      .filter((d) => (query.era ? d.era === query.era : true))
      .filter((d) => (query.artistId ? d.artistId === query.artistId : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = all.length;
    const start = (query.page - 1) * query.limit;
    const pageDocs = all.slice(start, start + query.limit);
    return {
      data: pageDocs.map(toPublicRecording),
      total,
      page: query.page,
      limit: query.limit,
      hasMore: start + query.limit < total,
    };
  }

  async listForModeration(query: ModerationQueryInput): Promise<Paginated<PublicRecording>> {
    // Admin view: every non-deleted recording (incl. drafts/review), newest first.
    const all = [...this.byId.values()]
      .filter((d) => !d.deletedAt)
      .filter((d) => (query.status ? d.status === query.status : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = all.length;
    const start = (query.page - 1) * query.limit;
    return {
      data: all.slice(start, start + query.limit).map(toPublicRecording),
      total,
      page: query.page,
      limit: query.limit,
      hasMore: start + query.limit < total,
    };
  }

  async updateModeration(
    id: string,
    patch: RecordingModerationInput,
  ): Promise<PublicRecording | null> {
    const doc = this.resolve(id);
    if (!doc || doc.deletedAt) return null;
    if (patch.status !== undefined) doc.status = patch.status;
    if (patch.visibility !== undefined) doc.visibility = patch.visibility;
    doc.updatedAt = new Date();
    return toPublicRecording(doc);
  }

  async updateAi(id: string, patch: RecordingAiPatch): Promise<PublicRecording | null> {
    const doc = this.resolve(id);
    if (!doc || doc.deletedAt) return null;
    // Merge: each pipeline stage lands independently (§10 — jobs don't block
    // each other), so a pitch result must not clobber an earlier transcript.
    doc.aiExtras = { ...doc.aiExtras, ...patch };
    doc.aiStatus = 'complete';
    doc.aiProcessedAt = new Date();
    doc.updatedAt = new Date();
    return toPublicRecording(doc);
  }

  async getFileKey(id: string): Promise<string | null> {
    const doc = this.resolve(id);
    return doc && !doc.deletedAt ? doc.fileKey : null;
  }

  async softDelete(id: string): Promise<void> {
    const doc = this.byId.get(id);
    if (doc && !doc.deletedAt) {
      doc.deletedAt = new Date();
      doc.updatedAt = new Date();
    }
  }

  // ── Dev-store snapshot/hydrate (not part of the persistence contract) ────────
  // Used only by the local dev seed store (scripts/seed.ts, shared/devStore) to
  // move the full in-memory state to and from a JSON file. A real DB-backed repo
  // has no equivalent — persistence is the database's job there.

  /** Export every stored document (including drafts/deleted) for a dev snapshot. */
  snapshot(): RecordingDoc[] {
    return [...this.byId.values()];
  }

  /** Replace all documents from a dev snapshot (dev bootstrap only). */
  hydrate(records: readonly RecordingDoc[]): void {
    this.byId.clear();
    for (const record of records) this.byId.set(record.id, record);
    this.seq = records.length; // keep generated humanIds ahead of seeded ones
  }
}

/**
 * Process-wide repository: MongoDB/Mongoose when PERSISTENCE=database, else the
 * in-memory implementation (tests + local dev without a database, and the dev-store
 * seed which relies on the InMemory snapshot/hydrate methods). Both satisfy
 * `RecordingRepository` (ADR-0005).
 */
export const recordingRepository: RecordingRepository = useDatabase()
  ? new MongoRecordingRepository()
  : new InMemoryRecordingRepository();
