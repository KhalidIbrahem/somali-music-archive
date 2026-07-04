/**
 * PostgreSQL user persistence (SESSION "db-backed repositories", ARCHITECTURE.md §9).
 *
 * The Prisma-backed `UserRepository` — the production implementation the in-memory
 * one (user.repository.ts) always stood in for (ADR-0005). Same interface, so no
 * service changes: the singleton in user.repository.ts binds here when
 * PERSISTENCE=database. Emails are stored lowercased (the register validator
 * lowercases them) and matched case-insensitively; soft-deleted rows are excluded.
 */

import { Prisma, type PrismaClient, type User } from '@prisma/client';
import type { UiLanguage } from '@sma/constants';
import type { CreateUserInput, ProfilePatch, UserRepository, UserRecord } from './user.repository';

/** Map a Prisma row to the internal `UserRecord` (language/role are enum-narrowed). */
function toUserRecord(row: User): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    language: row.language as UiLanguage,
    role: row.role,
    emailVerified: row.emailVerified,
    emailVerifiedAt: row.emailVerifiedAt,
    lastLoginAt: row.lastLoginAt,
    failedLoginAttempts: row.failedLoginAttempts,
    lockedUntil: row.lockedUntil,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

/** True for Prisma's "record to update not found" error (P2025). */
function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
    });
    return row ? toUserRecord(row) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const row = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    return row ? toUserRecord(row) : null;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    const row = await this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        displayName: input.displayName,
        language: input.language,
        ...(input.role ? { role: input.role } : {}),
      },
    });
    return toUserRecord(row);
  }

  async touchLastLogin(id: string): Promise<void> {
    await this.prisma.user.updateMany({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  async incrementFailedAttempts(id: string): Promise<number> {
    try {
      const row = await this.prisma.user.update({
        where: { id },
        data: { failedLoginAttempts: { increment: 1 } },
      });
      return row.failedLoginAttempts;
    } catch (error) {
      if (isRecordNotFound(error)) return 0; // match the in-memory no-throw contract
      throw error;
    }
  }

  async resetFailedAttempts(id: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  async lockUntil(id: string, until: Date): Promise<void> {
    await this.prisma.user.updateMany({ where: { id }, data: { lockedUntil: until } });
  }

  async markEmailVerified(id: string): Promise<void> {
    // Only the first verification stamps emailVerifiedAt (mirrors the in-memory guard).
    await this.prisma.user.updateMany({
      where: { id, emailVerified: false },
      data: { emailVerified: true, emailVerifiedAt: new Date() },
    });
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.prisma.user.updateMany({ where: { id }, data: { passwordHash } });
  }

  async updateProfile(id: string, patch: ProfilePatch): Promise<UserRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    const row = await this.prisma.user.update({
      where: { id },
      data: {
        ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
        ...(patch.language !== undefined ? { language: patch.language } : {}),
        ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
      },
    });
    return toUserRecord(row);
  }

  async addSaved(userId: string, recordingId: string): Promise<void> {
    await this.prisma.savedRecording.upsert({
      where: { userId_recordingId: { userId, recordingId } },
      create: { userId, recordingId },
      update: {},
    });
  }

  async removeSaved(userId: string, recordingId: string): Promise<void> {
    await this.prisma.savedRecording.deleteMany({ where: { userId, recordingId } });
  }

  async listSaved(userId: string): Promise<string[]> {
    const rows = await this.prisma.savedRecording.findMany({
      where: { userId },
      orderBy: { savedAt: 'desc' },
      select: { recordingId: true },
    });
    return rows.map((r) => r.recordingId);
  }
}
