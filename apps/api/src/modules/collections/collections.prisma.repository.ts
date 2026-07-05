/**
 * PostgreSQL collection persistence (SESSION P4-05, ARCHITECTURE.md §9 collections).
 *
 * Prisma-backed CollectionRepository over `collections` + `collection_items`. Binds
 * in place of the in-memory version when PERSISTENCE=database.
 */

import { Prisma, type Collection as CollectionRow, type PrismaClient } from '@prisma/client';
import type {
  CollectionRecord,
  CollectionRepository,
  CreateCollectionRecord,
} from './collections.repository';

function toRecord(row: CollectionRow): CollectionRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    description: row.description,
    isPublic: row.isPublic,
    createdAt: row.createdAt,
  };
}

export class PrismaCollectionRepository implements CollectionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateCollectionRecord): Promise<CollectionRecord> {
    const row = await this.prisma.collection.create({ data: input });
    return toRecord(row);
  }

  async findById(id: string): Promise<CollectionRecord | null> {
    const row = await this.prisma.collection.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async listForOwner(ownerId: string): Promise<CollectionRecord[]> {
    const rows = await this.prisma.collection.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toRecord);
  }

  async deleteCollection(id: string): Promise<void> {
    // Items cascade via the FK; the delete removes the collection row.
    await this.prisma.collection.deleteMany({ where: { id } });
  }

  async countItems(collectionId: string): Promise<number> {
    return this.prisma.collectionItem.count({ where: { collectionId } });
  }

  async addItem(collectionId: string, recordingId: string): Promise<void> {
    try {
      await this.prisma.collectionItem.create({ data: { collectionId, recordingId } });
    } catch (error) {
      // Unique-constraint violation = already in the collection; treat as success.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return;
      }
      throw error;
    }
  }

  async removeItem(collectionId: string, recordingId: string): Promise<boolean> {
    const result = await this.prisma.collectionItem.deleteMany({
      where: { collectionId, recordingId },
    });
    return result.count > 0;
  }

  async listItems(collectionId: string): Promise<string[]> {
    const rows = await this.prisma.collectionItem.findMany({
      where: { collectionId },
      orderBy: { addedAt: 'asc' },
      select: { recordingId: true },
    });
    return rows.map((r) => r.recordingId);
  }
}
