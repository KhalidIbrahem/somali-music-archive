/**
 * Invite persistence (SESSION "private access").
 *
 * Interface-first (ADR-0005): in-memory for tests/dev, Prisma/Postgres in
 * production. Redemption must never over-admit under concurrency, so `redeem`
 * is specified as an atomic compare-and-increment: it succeeds only while
 * usedCount < maxUses and the code is neither revoked nor expired.
 */

import { randomUUID } from '@/shared/crypto';
import { useDatabase } from '@/shared/db/driver';
import { getPrisma } from '@/shared/db/prisma';
import { PrismaInviteRepository } from './invite.prisma.repository';

export interface InviteCodeRecord {
  id: string;
  /** Uppercase human-friendly code, e.g. QG-4TKM-9PWH. */
  code: string;
  label: string | null;
  maxUses: number;
  usedCount: number;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdById: string;
  createdAt: Date;
}

export interface InviteRedemptionRecord {
  codeId: string;
  userId: string;
  redeemedAt: Date;
}

export interface CreateInviteRecord {
  code: string;
  label: string | null;
  maxUses: number;
  expiresAt: Date | null;
  createdById: string;
}

export interface InviteRepository {
  create(input: CreateInviteRecord): Promise<InviteCodeRecord>;
  findByCode(code: string): Promise<InviteCodeRecord | null>;
  findById(id: string): Promise<InviteCodeRecord | null>;
  /** Newest first, revoked/expired included (the panel shows history). */
  list(): Promise<InviteCodeRecord[]>;
  listRedemptions(codeIds: readonly string[]): Promise<InviteRedemptionRecord[]>;
  revoke(id: string): Promise<InviteCodeRecord | null>;
  /**
   * Atomically burn one use and record who redeemed it. Returns false when the
   * code raced to exhaustion/revocation between validation and redemption.
   */
  redeem(codeId: string, userId: string): Promise<boolean>;
}

export class InMemoryInviteRepository implements InviteRepository {
  private readonly byId = new Map<string, InviteCodeRecord>();
  private readonly redemptions: InviteRedemptionRecord[] = [];

  async create(input: CreateInviteRecord): Promise<InviteCodeRecord> {
    const record: InviteCodeRecord = {
      id: randomUUID(),
      code: input.code,
      label: input.label,
      maxUses: input.maxUses,
      usedCount: 0,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdById: input.createdById,
      createdAt: new Date(),
    };
    this.byId.set(record.id, record);
    return record;
  }

  async findByCode(code: string): Promise<InviteCodeRecord | null> {
    const needle = code.toUpperCase();
    for (const record of this.byId.values()) {
      if (record.code === needle) return record;
    }
    return null;
  }

  async findById(id: string): Promise<InviteCodeRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async list(): Promise<InviteCodeRecord[]> {
    return [...this.byId.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async listRedemptions(codeIds: readonly string[]): Promise<InviteRedemptionRecord[]> {
    const wanted = new Set(codeIds);
    return this.redemptions.filter((r) => wanted.has(r.codeId));
  }

  async revoke(id: string): Promise<InviteCodeRecord | null> {
    const record = this.byId.get(id);
    if (!record) return null;
    if (!record.revokedAt) record.revokedAt = new Date();
    return record;
  }

  async redeem(codeId: string, userId: string): Promise<boolean> {
    const record = this.byId.get(codeId);
    if (!record || record.revokedAt) return false;
    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) return false;
    if (record.usedCount >= record.maxUses) return false;
    record.usedCount += 1;
    this.redemptions.push({ codeId, userId, redeemedAt: new Date() });
    return true;
  }

  // ── Dev-store snapshot/hydrate (same seam as InMemoryUserRepository) ─────────

  snapshot(): { codes: InviteCodeRecord[]; redemptions: InviteRedemptionRecord[] } {
    return { codes: [...this.byId.values()], redemptions: [...this.redemptions] };
  }

  hydrate(
    codes: readonly InviteCodeRecord[],
    redemptions: readonly InviteRedemptionRecord[],
  ): void {
    this.byId.clear();
    this.redemptions.length = 0;
    for (const code of codes) this.byId.set(code.id, { ...code });
    this.redemptions.push(...redemptions.map((r) => ({ ...r })));
  }
}

/** Prisma/Postgres when PERSISTENCE=database, else in-memory (ADR-0005). */
export const inviteRepository: InviteRepository = useDatabase()
  ? new PrismaInviteRepository(getPrisma())
  : new InMemoryInviteRepository();
