/**
 * MongoDB recording persistence (SESSION "db-backed repositories", ARCHITECTURE.md §9).
 *
 * The Mongoose-backed RecordingRepository the in-memory one always stood in for
 * (ADR-0005). Same interface and same PublicRecording output, so services and the
 * search-index sync are unchanged; the singleton binds here when
 * PERSISTENCE=database. Soft delete only — documents are never removed (Principle 4).
 */

import mongoose from 'mongoose';
import type {
  AiStatus,
  AudioFormat,
  Paginated,
  PitchPoint,
  PublicRecording,
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
import { RecordingModel, type RecordingAiFields, type RecordingFields } from './recording.model';
import type {
  CreateDraftInput,
  RecordingAiPatch,
  RecordingRepository,
} from './recordings.repository';

/** Stable placeholder artist id from the singer's name (no artist collection yet). */
function artistIdFor(name: string): string {
  return sha256Hex(name.toLowerCase()).slice(0, 24);
}

/** Keep only the defined AI fields, mapping the opaque pitchData to PitchPoint[]. */
function aiExtras(ai: RecordingAiFields): RecordingAiPatch {
  return {
    ...(ai.transcriptSomali !== undefined ? { transcriptSomali: ai.transcriptSomali } : {}),
    ...(ai.transcriptEnglish !== undefined ? { transcriptEnglish: ai.transcriptEnglish } : {}),
    ...(ai.isSinging !== undefined ? { isSinging: ai.isSinging } : {}),
    ...(ai.pitchData !== undefined ? { pitchData: ai.pitchData as PitchPoint[] } : {}),
    ...(ai.dominantNotes !== undefined ? { dominantNotes: ai.dominantNotes } : {}),
    ...(ai.voicedFraction !== undefined ? { voicedFraction: ai.voicedFraction } : {}),
    ...(ai.embeddingId !== undefined ? { embeddingId: ai.embeddingId } : {}),
  };
}

/** Map a Mongo document to the public wire shape (mirrors the in-memory mapping). */
function toPublicRecording(doc: RecordingFields): PublicRecording {
  return {
    _id: asObjectId(String(doc._id)),
    id: doc.humanId,
    duration: doc.duration,
    fileSize: doc.fileSize,
    format: doc.format as AudioFormat,
    title: { somali: doc.title.somali },
    artist: { id: asObjectId(doc.artistId), name: doc.artistName },
    genre: doc.genre as Genre,
    instruments: doc.instruments as Instrument[],
    language: doc.language as ContentLanguage,
    ai: {
      status: doc.aiStatus as AiStatus,
      ...aiExtras(doc.ai),
      ...(doc.aiProcessedAt ? { processedAt: asIso(doc.aiProcessedAt) } : {}),
    },
    visibility: doc.visibility as RecordingVisibility,
    license: doc.license as RecordingLicense,
    status: doc.status as RecordingStatus,
    playCount: doc.playCount,
    saveCount: doc.saveCount,
    createdAt: asIso(doc.createdAt),
    updatedAt: asIso(doc.updatedAt),
    ...(doc.poetName ? { poet: { name: doc.poetName } } : {}),
    ...(doc.occasion ? { occasion: doc.occasion } : {}),
    ...(doc.region ? { region: doc.region as Region } : {}),
    ...(doc.era ? { era: doc.era } : {}),
  };
}

export class MongoRecordingRepository implements RecordingRepository {
  /** A per-day, zero-padded human id (e.g. "2026-07-04-001"). */
  private async nextHumanId(now: Date): Promise<string> {
    const datePart = now.toISOString().slice(0, 10);
    const startOfDay = new Date(`${datePart}T00:00:00.000Z`);
    const count = await RecordingModel.countDocuments({ createdAt: { $gte: startOfDay } });
    return `${datePart}-${String(count + 1).padStart(3, '0')}`;
  }

  /** Resolve a live document by its ObjectId OR its human id (clients use both). */
  private async findActive(idOrHumanId: string): Promise<RecordingFields | null> {
    const where = mongoose.isValidObjectId(idOrHumanId)
      ? { _id: idOrHumanId, deletedAt: null }
      : { humanId: idOrHumanId, deletedAt: null };
    return RecordingModel.findOne(where).lean<RecordingFields>().exec();
  }

  async createDraft(input: CreateDraftInput): Promise<{ recordingId: string }> {
    const now = new Date();
    const created = await RecordingModel.create({
      humanId: await this.nextHumanId(now),
      fileKey: input.fileKey,
      format: input.format,
      sessionId: input.sessionId,
      aiStatus: 'pending',
      status: 'draft',
      visibility: 'private',
    });
    return { recordingId: String(created._id) };
  }

  async complete(
    recordingId: string,
    metadata: RecordingCompleteMetadata,
  ): Promise<PublicRecording | null> {
    const updated = await RecordingModel.findOneAndUpdate(
      { _id: recordingId, deletedAt: null },
      {
        $set: {
          title: { somali: metadata.title.somali },
          artistName: metadata.singerName,
          artistId: artistIdFor(metadata.singerName),
          poetName: metadata.poetName ?? null,
          genre: metadata.genre,
          occasion: metadata.occasion ?? null,
          region: metadata.region ?? null,
          era: metadata.era ?? null,
          instruments: [...metadata.instruments],
          fieldNotes: metadata.fieldNotes ?? null,
          aiStatus: 'processing',
          status: 'review', // pending moderation before it is published
        },
      },
      { new: true },
    )
      .lean<RecordingFields>()
      .exec();
    return updated ? toPublicRecording(updated) : null;
  }

  async findById(id: string): Promise<PublicRecording | null> {
    const doc = await this.findActive(id);
    return doc ? toPublicRecording(doc) : null;
  }

  async list(query: RecordingQueryInput): Promise<Paginated<PublicRecording>> {
    // Only published recordings are public; drafts/review/archived are not listed.
    const where: Record<string, unknown> = { deletedAt: null, status: 'published' };
    if (query.genre) where['genre'] = query.genre;
    if (query.region) where['region'] = query.region;
    if (query.era) where['era'] = query.era;
    if (query.artistId) where['artistId'] = query.artistId;
    return this.paginate(where, query.page, query.limit);
  }

  async listForModeration(query: ModerationQueryInput): Promise<Paginated<PublicRecording>> {
    // Admin view: every non-deleted recording (incl. drafts/review), newest first.
    const where: Record<string, unknown> = { deletedAt: null };
    if (query.status) where['status'] = query.status;
    return this.paginate(where, query.page, query.limit);
  }

  /** Shared newest-first, offset-paginated query for list/listForModeration. */
  private async paginate(
    where: Record<string, unknown>,
    page: number,
    limit: number,
  ): Promise<Paginated<PublicRecording>> {
    const skip = (page - 1) * limit;
    const [docs, total] = await Promise.all([
      RecordingModel.find(where)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<RecordingFields[]>()
        .exec(),
      RecordingModel.countDocuments(where),
    ]);
    return {
      data: docs.map(toPublicRecording),
      total,
      page,
      limit,
      hasMore: skip + limit < total,
    };
  }

  async updateModeration(
    id: string,
    patch: RecordingModerationInput,
  ): Promise<PublicRecording | null> {
    const set: Record<string, unknown> = {};
    if (patch.status !== undefined) set['status'] = patch.status;
    if (patch.visibility !== undefined) set['visibility'] = patch.visibility;
    const updated = await RecordingModel.findOneAndUpdate(
      { ...(mongoose.isValidObjectId(id) ? { _id: id } : { humanId: id }), deletedAt: null },
      { $set: set },
      { new: true },
    )
      .lean<RecordingFields>()
      .exec();
    return updated ? toPublicRecording(updated) : null;
  }

  async updateAi(id: string, patch: RecordingAiPatch): Promise<PublicRecording | null> {
    // Merge each pipeline stage independently — a later stage must not clobber an
    // earlier one — via dot-path $set into the `ai` subdocument.
    const set: Record<string, unknown> = { aiStatus: 'complete', aiProcessedAt: new Date() };
    for (const [key, value] of Object.entries(patch)) {
      set[`ai.${key}`] = value;
    }
    const updated = await RecordingModel.findOneAndUpdate(
      { ...(mongoose.isValidObjectId(id) ? { _id: id } : { humanId: id }), deletedAt: null },
      { $set: set },
      { new: true },
    )
      .lean<RecordingFields>()
      .exec();
    return updated ? toPublicRecording(updated) : null;
  }

  async getFileKey(id: string): Promise<string | null> {
    const where = mongoose.isValidObjectId(id)
      ? { _id: id, deletedAt: null }
      : { humanId: id, deletedAt: null };
    const doc = await RecordingModel.findOne(where)
      .select('fileKey')
      .lean<{ fileKey: string }>()
      .exec();
    return doc ? doc.fileKey : null;
  }

  async softDelete(id: string): Promise<void> {
    await RecordingModel.updateOne(
      { ...(mongoose.isValidObjectId(id) ? { _id: id } : { humanId: id }), deletedAt: null },
      { $set: { deletedAt: new Date() } },
    ).exec();
  }
}
