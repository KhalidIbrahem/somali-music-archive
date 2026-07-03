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
  RecordingLicense,
  RecordingStatus,
  RecordingVisibility,
} from '@sma/types';
import type { ContentLanguage, Genre, Instrument, Region } from '@sma/constants';
import type {
  RecordingCompleteMetadata,
  RecordingQueryInput,
  SearchQueryInput,
} from '@sma/validators';
import { asIso, asObjectId } from '@/shared/brand';
import { sha256Hex } from '@/shared/crypto';

interface RecordingDoc {
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

export interface RecordingRepository {
  createDraft(input: CreateDraftInput): Promise<{ recordingId: string }>;
  complete(
    recordingId: string,
    metadata: RecordingCompleteMetadata,
  ): Promise<PublicRecording | null>;
  findById(id: string): Promise<PublicRecording | null>;
  list(query: RecordingQueryInput): Promise<Paginated<PublicRecording>>;
  search(query: SearchQueryInput): Promise<Paginated<PublicRecording>>;
  getFileKey(id: string): Promise<string | null>;
  softDelete(id: string): Promise<void>;
}

/** Derive a stable placeholder artist id from the singer's name (until the artist
 * collection exists, the name is the identity). */
function artistIdFor(name: string): string {
  return sha256Hex(name.toLowerCase()).slice(0, 24);
}

/** Lowercased haystack for free-text search (title, artist, genre, era, occasion,
 * poet). A Mongo text index / Elasticsearch replaces this in Phase 2/3 (§14). */
function searchableText(doc: RecordingDoc): string {
  return [
    doc.title.somali,
    doc.artistName,
    doc.genre,
    doc.era ?? '',
    doc.occasion ?? '',
    doc.poetName ?? '',
  ]
    .join(' ')
    .toLowerCase();
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
    ai: { status: doc.aiStatus },
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

  async findById(id: string): Promise<PublicRecording | null> {
    const doc = this.byId.get(id);
    return doc && !doc.deletedAt ? toPublicRecording(doc) : null;
  }

  async list(query: RecordingQueryInput): Promise<Paginated<PublicRecording>> {
    const all = [...this.byId.values()]
      .filter((d) => !d.deletedAt && d.status !== 'draft')
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

  async search(query: SearchQueryInput): Promise<Paginated<PublicRecording>> {
    const needle = query.q?.trim().toLowerCase() ?? '';
    const matches = [...this.byId.values()]
      .filter((d) => !d.deletedAt && d.status !== 'draft')
      .filter((d) => (query.genre ? d.genre === query.genre : true))
      .filter((d) => (query.region ? d.region === query.region : true))
      .filter((d) => (query.era ? d.era === query.era : true))
      .filter((d) => (needle ? searchableText(d).includes(needle) : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = matches.length;
    const start = (query.page - 1) * query.limit;
    return {
      data: matches.slice(start, start + query.limit).map(toPublicRecording),
      total,
      page: query.page,
      limit: query.limit,
      hasMore: start + query.limit < total,
    };
  }

  async getFileKey(id: string): Promise<string | null> {
    const doc = this.byId.get(id);
    return doc && !doc.deletedAt ? doc.fileKey : null;
  }

  async softDelete(id: string): Promise<void> {
    const doc = this.byId.get(id);
    if (doc && !doc.deletedAt) {
      doc.deletedAt = new Date();
      doc.updatedAt = new Date();
    }
  }
}

export const recordingRepository: RecordingRepository = new InMemoryRecordingRepository();
