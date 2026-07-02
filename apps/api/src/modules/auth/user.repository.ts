/**
 * User persistence (ARCHITECTURE.md §9 users table).
 *
 * The service depends on the `UserRepository` INTERFACE, not on a concrete
 * database. Phase 0 ships an in-memory implementation so the auth flow runs and is
 * unit-testable with zero infrastructure; Phase 1 swaps in a Prisma-backed
 * implementation (prisma/schema.prisma) behind the same interface — no service
 * changes required. This is the "extractable later, no rewrite" seam (Principle 6).
 */

import { randomUUID } from 'node:crypto';
import type { UiLanguage } from '@sma/constants';
import type { PublicUser, UserRole } from '@sma/types';
import { asIso, asUuid } from '@/shared/brand';

/** Internal row shape — carries the password hash, which never leaves this layer. */
export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  avatarUrl: string | null;
  language: UiLanguage;
  role: UserRole;
  emailVerified: boolean;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** Fields required to create a user. */
export interface CreateUserInput {
  email: string;
  passwordHash: string;
  displayName: string;
  language: UiLanguage;
  role?: UserRole;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  create(input: CreateUserInput): Promise<UserRecord>;
  touchLastLogin(id: string): Promise<void>;
}

/** Strip secrets and map an internal row to the public wire shape. */
export function toPublicUser(record: UserRecord): PublicUser {
  return {
    id: asUuid(record.id),
    email: record.email,
    displayName: record.displayName,
    ...(record.avatarUrl ? { avatarUrl: record.avatarUrl } : {}),
    language: record.language,
    role: record.role,
    emailVerified: record.emailVerified,
    ...(record.emailVerifiedAt ? { emailVerifiedAt: asIso(record.emailVerifiedAt) } : {}),
    ...(record.lastLoginAt ? { lastLoginAt: asIso(record.lastLoginAt) } : {}),
    createdAt: asIso(record.createdAt),
    updatedAt: asIso(record.updatedAt),
    ...(record.deletedAt ? { deletedAt: asIso(record.deletedAt) } : {}),
  };
}

/**
 * In-memory repository for Phase 0 / tests. Not persistent across restarts — that
 * is intentional; it exists only so the API is runnable before the database is
 * provisioned. Emails are matched case-insensitively.
 */
export class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, UserRecord>();

  async findByEmail(email: string): Promise<UserRecord | null> {
    const needle = email.toLowerCase();
    for (const record of this.byId.values()) {
      if (record.email.toLowerCase() === needle && !record.deletedAt) return record;
    }
    return null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const record = this.byId.get(id);
    return record && !record.deletedAt ? record : null;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    const now = new Date();
    const record: UserRecord = {
      id: randomUUID(),
      email: input.email,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      avatarUrl: null,
      language: input.language,
      role: input.role ?? 'listener',
      emailVerified: false,
      emailVerifiedAt: null,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.byId.set(record.id, record);
    return record;
  }

  async touchLastLogin(id: string): Promise<void> {
    const record = this.byId.get(id);
    if (record) {
      record.lastLoginAt = new Date();
      record.updatedAt = new Date();
    }
  }
}

/** Process-wide default repository. Swap this construction for Prisma in Phase 1. */
export const userRepository: UserRepository = new InMemoryUserRepository();
