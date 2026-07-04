/**
 * PostgreSQL verification-token persistence (SESSION "db-backed repositories",
 * ARCHITECTURE.md §9 verification_tokens, §11).
 *
 * Prisma-backed implementation over the `verification_tokens` table. Single-use,
 * expiring tokens for email verification / password reset; only the SHA-256 hash
 * is stored. Binds in place of the in-memory version when PERSISTENCE=database.
 */

import type { PrismaClient, VerificationToken } from '@prisma/client';
import type {
  VerificationPurpose,
  VerificationTokenRecord,
  VerificationTokenRepository,
} from './verificationToken.repository';

function toRecord(row: VerificationToken): VerificationTokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    purpose: row.purpose,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
  };
}

export class PrismaVerificationTokenRepository implements VerificationTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    userId: string,
    tokenHash: string,
    purpose: VerificationPurpose,
    expiresAt: Date,
  ): Promise<VerificationTokenRecord> {
    const row = await this.prisma.verificationToken.create({
      data: { userId, tokenHash, purpose, expiresAt },
    });
    return toRecord(row);
  }

  async findValid(
    tokenHash: string,
    purpose: VerificationPurpose,
  ): Promise<VerificationTokenRecord | null> {
    const row = await this.prisma.verificationToken.findFirst({
      where: { tokenHash, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    });
    return row ? toRecord(row) : null;
  }

  async consume(id: string): Promise<void> {
    await this.prisma.verificationToken.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }
}
