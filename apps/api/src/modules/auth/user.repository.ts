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
import { useDatabase } from '@/shared/db/driver';
import { getPrisma } from '@/shared/db/prisma';
import { PrismaUserRepository } from './user.prisma.repository';

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
  /** Consecutive failed login attempts; reset to 0 on success (§11 Threat 2). */
  failedLoginAttempts: number;
  /** When set and in the future, login is refused (account lockout). */
  lockedUntil: Date | null;
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
  /** Increment the failed-attempt counter and return the new value. */
  incrementFailedAttempts(id: string): Promise<number>;
  resetFailedAttempts(id: string): Promise<void>;
  /** Lock the account until the given time (§11 — lockout after 10 failures). */
  lockUntil(id: string, until: Date): Promise<void>;
  markEmailVerified(id: string): Promise<void>;
  updatePassword(id: string, passwordHash: string): Promise<void>;
  /** Update editable profile fields; returns the updated record (or null). */
  updateProfile(id: string, patch: ProfilePatch): Promise<UserRecord | null>;
  // ── Saved recordings (bookmarks, ARCHITECTURE.md §9 saved_recordings) ──
  addSaved(userId: string, recordingId: string): Promise<void>;
  removeSaved(userId: string, recordingId: string): Promise<void>;
  listSaved(userId: string): Promise<string[]>;
}

export interface ProfilePatch {
  displayName?: string | undefined;
  language?: UiLanguage | undefined;
  avatarUrl?: string | undefined;
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
  /** userId → set of saved recording ids. */
  private readonly saved = new Map<string, Set<string>>();

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
      failedLoginAttempts: 0,
      lockedUntil: null,
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

  async incrementFailedAttempts(id: string): Promise<number> {
    const record = this.byId.get(id);
    if (!record) return 0;
    record.failedLoginAttempts += 1;
    record.updatedAt = new Date();
    return record.failedLoginAttempts;
  }

  async resetFailedAttempts(id: string): Promise<void> {
    const record = this.byId.get(id);
    if (record) {
      record.failedLoginAttempts = 0;
      record.lockedUntil = null;
      record.updatedAt = new Date();
    }
  }

  async lockUntil(id: string, until: Date): Promise<void> {
    const record = this.byId.get(id);
    if (record) {
      record.lockedUntil = until;
      record.updatedAt = new Date();
    }
  }

  async markEmailVerified(id: string): Promise<void> {
    const record = this.byId.get(id);
    if (record && !record.emailVerified) {
      record.emailVerified = true;
      record.emailVerifiedAt = new Date();
      record.updatedAt = new Date();
    }
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    const record = this.byId.get(id);
    if (record) {
      record.passwordHash = passwordHash;
      record.updatedAt = new Date();
    }
  }

  async updateProfile(id: string, patch: ProfilePatch): Promise<UserRecord | null> {
    const record = this.byId.get(id);
    if (!record || record.deletedAt) return null;
    if (patch.displayName !== undefined) record.displayName = patch.displayName;
    if (patch.language !== undefined) record.language = patch.language;
    if (patch.avatarUrl !== undefined) record.avatarUrl = patch.avatarUrl;
    record.updatedAt = new Date();
    return record;
  }

  async addSaved(userId: string, recordingId: string): Promise<void> {
    let set = this.saved.get(userId);
    if (!set) {
      set = new Set();
      this.saved.set(userId, set);
    }
    set.add(recordingId);
  }

  async removeSaved(userId: string, recordingId: string): Promise<void> {
    this.saved.get(userId)?.delete(recordingId);
  }

  async listSaved(userId: string): Promise<string[]> {
    return [...(this.saved.get(userId) ?? [])];
  }

  // ── Dev-store snapshot/hydrate (not part of the persistence contract) ────────
  // Used only by the local dev seed store (scripts/seed.ts, scripts/promote.ts,
  // shared/devStore) to move the full in-memory state to and from a JSON file. A
  // real DB-backed repo has no equivalent — persistence is the database's job.

  /** Export every stored user row for a dev snapshot. */
  snapshot(): UserRecord[] {
    return [...this.byId.values()];
  }

  /** Replace all rows from a dev snapshot (dev bootstrap only). */
  hydrate(records: readonly UserRecord[]): void {
    this.byId.clear();
    for (const record of records) this.byId.set(record.id, record);
  }
}

/**
 * Process-wide repository: Prisma/Postgres when PERSISTENCE=database, else the
 * in-memory implementation (tests + local dev without a database). Both satisfy
 * `UserRepository`, so services depend only on the interface (ADR-0005).
 */
export const userRepository: UserRepository = useDatabase()
  ? new PrismaUserRepository(getPrisma())
  : new InMemoryUserRepository();
