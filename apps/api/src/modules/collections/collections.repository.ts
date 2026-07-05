/**
 * Collection persistence (SESSION P4-05, ARCHITECTURE.md §9 collections).
 *
 * A user's curated list plus its items (recording ObjectId strings — no FK, since
 * recordings live in Mongo). Collections are user data, so a delete is a real
 * delete that cascades its items (not a soft delete — Principle 4 protects the
 * recordings themselves, not personal lists). Interface-first (ADR-0005): the
 * singleton binds to Prisma when PERSISTENCE=database, else in-memory.
 */

import { randomUUID } from '@/shared/crypto';
import { useDatabase } from '@/shared/db/driver';
import { getPrisma } from '@/shared/db/prisma';
import { PrismaCollectionRepository } from './collections.prisma.repository';

export interface CollectionRecord {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  createdAt: Date;
}

export interface CreateCollectionRecord {
  ownerId: string;
  name: string;
  description: string | null;
  isPublic: boolean;
}

export interface CollectionRepository {
  create(input: CreateCollectionRecord): Promise<CollectionRecord>;
  findById(id: string): Promise<CollectionRecord | null>;
  listForOwner(ownerId: string): Promise<CollectionRecord[]>;
  deleteCollection(id: string): Promise<void>;
  countItems(collectionId: string): Promise<number>;
  /** Add a recording (idempotent on the composite key). */
  addItem(collectionId: string, recordingId: string): Promise<void>;
  removeItem(collectionId: string, recordingId: string): Promise<boolean>;
  /** Recording ids in the collection, in the order they were added. */
  listItems(collectionId: string): Promise<string[]>;
}

interface Item {
  collectionId: string;
  recordingId: string;
  addedAt: Date;
}

export class InMemoryCollectionRepository implements CollectionRepository {
  private readonly byId = new Map<string, CollectionRecord>();
  private items: Item[] = [];

  async create(input: CreateCollectionRecord): Promise<CollectionRecord> {
    const record: CollectionRecord = {
      id: randomUUID(),
      ownerId: input.ownerId,
      name: input.name,
      description: input.description,
      isPublic: input.isPublic,
      createdAt: new Date(),
    };
    this.byId.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<CollectionRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async listForOwner(ownerId: string): Promise<CollectionRecord[]> {
    return [...this.byId.values()]
      .filter((c) => c.ownerId === ownerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async deleteCollection(id: string): Promise<void> {
    this.byId.delete(id);
    this.items = this.items.filter((i) => i.collectionId !== id);
  }

  async countItems(collectionId: string): Promise<number> {
    return this.items.filter((i) => i.collectionId === collectionId).length;
  }

  async addItem(collectionId: string, recordingId: string): Promise<void> {
    const exists = this.items.some(
      (i) => i.collectionId === collectionId && i.recordingId === recordingId,
    );
    if (!exists) this.items.push({ collectionId, recordingId, addedAt: new Date() });
  }

  async removeItem(collectionId: string, recordingId: string): Promise<boolean> {
    const before = this.items.length;
    this.items = this.items.filter(
      (i) => !(i.collectionId === collectionId && i.recordingId === recordingId),
    );
    return this.items.length < before;
  }

  async listItems(collectionId: string): Promise<string[]> {
    return this.items
      .filter((i) => i.collectionId === collectionId)
      .sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime())
      .map((i) => i.recordingId);
  }
}

export const collectionRepository: CollectionRepository = useDatabase()
  ? new PrismaCollectionRepository(getPrisma())
  : new InMemoryCollectionRepository();
