/**
 * Refresh-token persistence (ARCHITECTURE.md §9 refresh_tokens, §11).
 *
 * Refresh tokens are stored ONLY as a SHA-256 hash (never plaintext) so a database
 * leak cannot be used to mint sessions. On every use the presented token is looked
 * up by hash, revoked, and replaced (rotation) — a stolen-then-replayed token no
 * longer matches an active row and is rejected.
 *
 * Interface-first (ADR-0005): Phase 1 provides a Prisma-backed implementation over
 * the `refresh_tokens` table; the in-memory implementation here makes the flow
 * runnable and testable now.
 */

import { randomUUID } from '@/shared/crypto';
import { useDatabase } from '@/shared/db/driver';
import { getPrisma } from '@/shared/db/prisma';
import { PrismaRefreshTokenRepository } from './refreshToken.prisma.repository';

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface RefreshTokenRepository {
  create(userId: string, tokenHash: string, expiresAt: Date): Promise<RefreshTokenRecord>;
  /** Find a non-revoked, non-expired token for the user matching the hash. */
  findActive(userId: string, tokenHash: string): Promise<RefreshTokenRecord | null>;
  revoke(id: string): Promise<void>;
  /** Revoke every token for a user (logout-everywhere, password reset). */
  revokeAllForUser(userId: string): Promise<void>;
}

export class InMemoryRefreshTokenRepository implements RefreshTokenRepository {
  private readonly byId = new Map<string, RefreshTokenRecord>();

  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<RefreshTokenRecord> {
    const record: RefreshTokenRecord = {
      id: randomUUID(),
      userId,
      tokenHash,
      expiresAt,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.byId.set(record.id, record);
    return record;
  }

  async findActive(userId: string, tokenHash: string): Promise<RefreshTokenRecord | null> {
    const now = Date.now();
    for (const record of this.byId.values()) {
      if (
        record.userId === userId &&
        record.tokenHash === tokenHash &&
        record.revokedAt === null &&
        record.expiresAt.getTime() > now
      ) {
        return record;
      }
    }
    return null;
  }

  async revoke(id: string): Promise<void> {
    const record = this.byId.get(id);
    if (record && record.revokedAt === null) {
      record.revokedAt = new Date();
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    for (const record of this.byId.values()) {
      if (record.userId === userId && record.revokedAt === null) {
        record.revokedAt = new Date();
      }
    }
  }
}

export const refreshTokenRepository: RefreshTokenRepository = useDatabase()
  ? new PrismaRefreshTokenRepository(getPrisma())
  : new InMemoryRefreshTokenRepository();
