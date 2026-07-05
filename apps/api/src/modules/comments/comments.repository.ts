/**
 * Comment persistence (SESSION P4-05, ARCHITECTURE.md §9 comments).
 *
 * Soft-delete only (a removed comment is hidden, never destroyed — useful for
 * moderation audit). `recordingId` is the recording's Mongo ObjectId string; there
 * is no FK because recordings live in Mongo. Interface-first (ADR-0005): the
 * singleton binds to Prisma when PERSISTENCE=database, else in-memory.
 */

import { randomUUID } from '@/shared/crypto';
import { useDatabase } from '@/shared/db/driver';
import { getPrisma } from '@/shared/db/prisma';
import { PrismaCommentRepository } from './comments.prisma.repository';

export interface CommentRecord {
  id: string;
  recordingId: string;
  userId: string;
  authorName: string;
  body: string;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface CreateCommentRecord {
  recordingId: string;
  userId: string;
  authorName: string;
  body: string;
}

export interface CommentRepository {
  create(input: CreateCommentRecord): Promise<CommentRecord>;
  /** A live (non-deleted) comment by id. */
  findById(id: string): Promise<CommentRecord | null>;
  /** A recording's live comments, newest first, paginated. */
  listForRecording(
    recordingId: string,
    page: number,
    limit: number,
  ): Promise<{ items: CommentRecord[]; total: number }>;
  softDelete(id: string): Promise<void>;
}

export class InMemoryCommentRepository implements CommentRepository {
  private readonly byId = new Map<string, CommentRecord>();

  async create(input: CreateCommentRecord): Promise<CommentRecord> {
    const record: CommentRecord = {
      id: randomUUID(),
      recordingId: input.recordingId,
      userId: input.userId,
      authorName: input.authorName,
      body: input.body,
      createdAt: new Date(),
      deletedAt: null,
    };
    this.byId.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<CommentRecord | null> {
    const record = this.byId.get(id);
    return record && !record.deletedAt ? record : null;
  }

  async listForRecording(
    recordingId: string,
    page: number,
    limit: number,
  ): Promise<{ items: CommentRecord[]; total: number }> {
    // Map preserves insertion (chronological) order; reverse for newest-first —
    // deterministic even when two comments share a millisecond timestamp.
    const all = [...this.byId.values()]
      .filter((c) => c.recordingId === recordingId && !c.deletedAt)
      .reverse();
    const start = (page - 1) * limit;
    return { items: all.slice(start, start + limit), total: all.length };
  }

  async softDelete(id: string): Promise<void> {
    const record = this.byId.get(id);
    if (record && !record.deletedAt) record.deletedAt = new Date();
  }
}

export const commentRepository: CommentRepository = useDatabase()
  ? new PrismaCommentRepository(getPrisma())
  : new InMemoryCommentRepository();
