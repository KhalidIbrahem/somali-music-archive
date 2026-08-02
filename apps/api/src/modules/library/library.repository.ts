/**
 * Library persistence — the shelf of scanned music-sheet books.
 *
 * Books are archive material, so removal is a SOFT delete (Principle 4 — nothing
 * contributed to the archive is ever destroyed). Interface-first (ADR-0005); the
 * in-memory implementation is the dev/test driver, and a database driver can bind
 * here when the library grows a Prisma/Mongo model.
 */

import type { BookContentType } from '@sma/types';
import { randomUUID } from '@/shared/crypto';

export interface BookRecord {
  id: string;
  title: string;
  author: string | null;
  description: string | null;
  contentType: BookContentType;
  fileKey: string;
  uploadedBy: string;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface CreateBookRecord {
  title: string;
  author: string | null;
  description: string | null;
  contentType: BookContentType;
  fileKey: string;
  uploadedBy: string;
}

export interface LibraryRepository {
  create(input: CreateBookRecord): Promise<BookRecord>;
  findById(id: string): Promise<BookRecord | null>;
  /** Newest first; soft-deleted books never leave this repository. */
  list(): Promise<BookRecord[]>;
  softDelete(id: string): Promise<boolean>;
}

export class InMemoryLibraryRepository implements LibraryRepository {
  private readonly byId = new Map<string, BookRecord>();

  async create(input: CreateBookRecord): Promise<BookRecord> {
    const record: BookRecord = {
      id: randomUUID(),
      title: input.title,
      author: input.author,
      description: input.description,
      contentType: input.contentType,
      fileKey: input.fileKey,
      uploadedBy: input.uploadedBy,
      createdAt: new Date(),
      deletedAt: null,
    };
    this.byId.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<BookRecord | null> {
    const record = this.byId.get(id);
    return record && !record.deletedAt ? record : null;
  }

  async list(): Promise<BookRecord[]> {
    return [...this.byId.values()]
      .filter((b) => !b.deletedAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async softDelete(id: string): Promise<boolean> {
    const record = this.byId.get(id);
    if (!record || record.deletedAt) return false;
    record.deletedAt = new Date();
    return true;
  }
}

export const libraryRepository: LibraryRepository = new InMemoryLibraryRepository();
