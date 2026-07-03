/**
 * One-time verification tokens for email verification and password reset
 * (ARCHITECTURE.md §11 Compliance/Authentication).
 *
 * Same at-rest rule as refresh tokens: only the SHA-256 hash is stored; the raw
 * token travels only in the email link. Tokens expire and are single-use
 * (`consumedAt`). Interface-first (ADR-0005) with an in-memory implementation.
 */

import { randomUUID } from '@/shared/crypto';

export type VerificationPurpose = 'email_verify' | 'password_reset';

export interface VerificationTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  purpose: VerificationPurpose;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface VerificationTokenRepository {
  create(
    userId: string,
    tokenHash: string,
    purpose: VerificationPurpose,
    expiresAt: Date,
  ): Promise<VerificationTokenRecord>;
  /** Find an unconsumed, unexpired token matching the hash + purpose. */
  findValid(
    tokenHash: string,
    purpose: VerificationPurpose,
  ): Promise<VerificationTokenRecord | null>;
  consume(id: string): Promise<void>;
}

export class InMemoryVerificationTokenRepository implements VerificationTokenRepository {
  private readonly byId = new Map<string, VerificationTokenRecord>();

  async create(
    userId: string,
    tokenHash: string,
    purpose: VerificationPurpose,
    expiresAt: Date,
  ): Promise<VerificationTokenRecord> {
    const record: VerificationTokenRecord = {
      id: randomUUID(),
      userId,
      tokenHash,
      purpose,
      expiresAt,
      consumedAt: null,
      createdAt: new Date(),
    };
    this.byId.set(record.id, record);
    return record;
  }

  async findValid(
    tokenHash: string,
    purpose: VerificationPurpose,
  ): Promise<VerificationTokenRecord | null> {
    const now = Date.now();
    for (const record of this.byId.values()) {
      if (
        record.tokenHash === tokenHash &&
        record.purpose === purpose &&
        record.consumedAt === null &&
        record.expiresAt.getTime() > now
      ) {
        return record;
      }
    }
    return null;
  }

  async consume(id: string): Promise<void> {
    const record = this.byId.get(id);
    if (record && record.consumedAt === null) {
      record.consumedAt = new Date();
    }
  }
}

export const verificationTokenRepository: VerificationTokenRepository =
  new InMemoryVerificationTokenRepository();
