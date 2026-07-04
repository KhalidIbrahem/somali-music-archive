/**
 * PostgreSQL refresh-token persistence (SESSION "db-backed repositories",
 * ARCHITECTURE.md §9 refresh_tokens, §11).
 *
 * Prisma-backed implementation of RefreshTokenRepository over the `refresh_tokens`
 * table. Only the SHA-256 hash is stored (never plaintext); rotation revokes the
 * old row on every use. Binds in place of the in-memory version when
 * PERSISTENCE=database.
 */

import type { PrismaClient, RefreshToken } from '@prisma/client';
import type { RefreshTokenRecord, RefreshTokenRepository } from './refreshToken.repository';

function toRecord(row: RefreshToken): RefreshTokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<RefreshTokenRecord> {
    const row = await this.prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
    return toRecord(row);
  }

  async findActive(userId: string, tokenHash: string): Promise<RefreshTokenRecord | null> {
    const row = await this.prisma.refreshToken.findFirst({
      where: { userId, tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    return row ? toRecord(row) : null;
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
