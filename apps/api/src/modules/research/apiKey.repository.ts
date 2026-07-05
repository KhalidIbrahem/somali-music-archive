/**
 * Research API key persistence (ARCHITECTURE.md §9 api_keys, SESSION P3-07).
 *
 * Keys are stored ONLY as a bcrypt hash (never plaintext) plus a short prefix used
 * to narrow the lookup before the hash comparison — the same at-rest rule as
 * passwords and refresh tokens. Interface-first (ADR-0005): the singleton binds to
 * the Prisma implementation when PERSISTENCE=database, else in-memory.
 */

import type { ApiKeyPlan } from '@sma/types';
import { randomUUID } from '@/shared/crypto';
import { useDatabase } from '@/shared/db/driver';
import { getPrisma } from '@/shared/db/prisma';
import { PrismaApiKeyRepository } from './apiKey.prisma.repository';

export interface ApiKeyRecord {
  id: string;
  userId: string;
  keyHash: string;
  keyPrefix: string;
  name: string;
  plan: ApiKeyPlan;
  rateLimit: number;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface CreateApiKeyRecord {
  userId: string;
  keyHash: string;
  keyPrefix: string;
  name: string;
  plan: ApiKeyPlan;
  rateLimit: number;
  expiresAt: Date | null;
}

export interface ApiKeyRepository {
  create(input: CreateApiKeyRecord): Promise<ApiKeyRecord>;
  /** Non-revoked keys sharing a prefix — candidates for the hash comparison. */
  findActiveByPrefix(prefix: string): Promise<ApiKeyRecord[]>;
  /** A user's keys, newest first (revoked included, for the management UI). */
  listForUser(userId: string): Promise<ApiKeyRecord[]>;
  touchLastUsed(id: string): Promise<void>;
  /** Revoke a key the user owns; false if it is not theirs / not found. */
  revoke(id: string, userId: string): Promise<boolean>;
}

export class InMemoryApiKeyRepository implements ApiKeyRepository {
  private readonly byId = new Map<string, ApiKeyRecord>();

  async create(input: CreateApiKeyRecord): Promise<ApiKeyRecord> {
    const record: ApiKeyRecord = {
      id: randomUUID(),
      userId: input.userId,
      keyHash: input.keyHash,
      keyPrefix: input.keyPrefix,
      name: input.name,
      plan: input.plan,
      rateLimit: input.rateLimit,
      lastUsedAt: null,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.byId.set(record.id, record);
    return record;
  }

  async findActiveByPrefix(prefix: string): Promise<ApiKeyRecord[]> {
    return [...this.byId.values()].filter((k) => k.keyPrefix === prefix && k.revokedAt === null);
  }

  async listForUser(userId: string): Promise<ApiKeyRecord[]> {
    return [...this.byId.values()]
      .filter((k) => k.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async touchLastUsed(id: string): Promise<void> {
    const record = this.byId.get(id);
    if (record) record.lastUsedAt = new Date();
  }

  async revoke(id: string, userId: string): Promise<boolean> {
    const record = this.byId.get(id);
    if (!record || record.userId !== userId || record.revokedAt !== null) return false;
    record.revokedAt = new Date();
    return true;
  }
}

export const apiKeyRepository: ApiKeyRepository = useDatabase()
  ? new PrismaApiKeyRepository(getPrisma())
  : new InMemoryApiKeyRepository();
