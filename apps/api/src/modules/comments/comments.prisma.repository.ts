/**
 * PostgreSQL comment persistence (SESSION P4-05, ARCHITECTURE.md §9 comments).
 *
 * Prisma-backed CommentRepository over the `comments` table. Binds in place of the
 * in-memory version when PERSISTENCE=database.
 */

import type { Comment as CommentRow, PrismaClient } from '@prisma/client';
import type { CommentRecord, CommentRepository, CreateCommentRecord } from './comments.repository';

function toRecord(row: CommentRow): CommentRecord {
  return {
    id: row.id,
    recordingId: row.recordingId,
    userId: row.userId,
    authorName: row.authorName,
    body: row.body,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  };
}

export class PrismaCommentRepository implements CommentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateCommentRecord): Promise<CommentRecord> {
    const row = await this.prisma.comment.create({ data: input });
    return toRecord(row);
  }

  async findById(id: string): Promise<CommentRecord | null> {
    const row = await this.prisma.comment.findFirst({ where: { id, deletedAt: null } });
    return row ? toRecord(row) : null;
  }

  async listForRecording(
    recordingId: string,
    page: number,
    limit: number,
  ): Promise<{ items: CommentRecord[]; total: number }> {
    const where = { recordingId, deletedAt: null };
    const [rows, total] = await Promise.all([
      this.prisma.comment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.comment.count({ where }),
    ]);
    return { items: rows.map(toRecord), total };
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.comment.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
}
