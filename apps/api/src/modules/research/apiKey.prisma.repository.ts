/**
 * PostgreSQL research API key persistence (SESSION P3-07, ARCHITECTURE.md §9 api_keys).
 *
 * Prisma-backed ApiKeyRepository over the `api_keys` table. Binds in place of the
 * in-memory version when PERSISTENCE=database.
 */

import type { ApiKey as ApiKeyRow, PrismaClient } from '@prisma/client';
import type { ApiKeyPlan } from '@sma/types';
import type { ApiKeyRecord, ApiKeyRepository, CreateApiKeyRecord } from './apiKey.repository';

function toRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    userId: row.userId,
    keyHash: row.keyHash,
    keyPrefix: row.keyPrefix,
    name: row.name,
    plan: row.plan as ApiKeyPlan,
    rateLimit: row.rateLimit,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

export class PrismaApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateApiKeyRecord): Promise<ApiKeyRecord> {
    const row = await this.prisma.apiKey.create({
      data: {
        userId: input.userId,
        keyHash: input.keyHash,
        keyPrefix: input.keyPrefix,
        name: input.name,
        plan: input.plan,
        rateLimit: input.rateLimit,
        expiresAt: input.expiresAt,
      },
    });
    return toRecord(row);
  }

  async findActiveByPrefix(prefix: string): Promise<ApiKeyRecord[]> {
    const rows = await this.prisma.apiKey.findMany({
      where: { keyPrefix: prefix, revokedAt: null },
    });
    return rows.map(toRecord);
  }

  async listForUser(userId: string): Promise<ApiKeyRecord[]> {
    const rows = await this.prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toRecord);
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.prisma.apiKey.updateMany({ where: { id }, data: { lastUsedAt: new Date() } });
  }

  async revoke(id: string, userId: string): Promise<boolean> {
    const result = await this.prisma.apiKey.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count > 0;
  }
}
