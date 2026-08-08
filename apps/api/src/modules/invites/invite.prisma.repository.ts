/**
 * PostgreSQL invite persistence (SESSION "private access").
 *
 * `redeem` is a transaction: an optimistic compare-and-increment on usedCount
 * (updateMany's WHERE re-checks every admission condition, so two concurrent
 * registrations can never burn the same last use) followed by the redemption
 * row. Prisma cannot compare two columns in a filter, so the CAS pins the
 * usedCount value read inside the same transaction.
 */

import type { InviteCode, PrismaClient } from '@prisma/client';
import type {
  CreateInviteRecord,
  InviteCodeRecord,
  InviteRedemptionRecord,
  InviteRepository,
} from './invite.repository';

function toRecord(row: InviteCode): InviteCodeRecord {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdById: row.createdById,
    createdAt: row.createdAt,
  };
}

export class PrismaInviteRepository implements InviteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateInviteRecord): Promise<InviteCodeRecord> {
    const row = await this.prisma.inviteCode.create({
      data: {
        code: input.code,
        label: input.label,
        maxUses: input.maxUses,
        expiresAt: input.expiresAt,
        createdById: input.createdById,
      },
    });
    return toRecord(row);
  }

  async findByCode(code: string): Promise<InviteCodeRecord | null> {
    const row = await this.prisma.inviteCode.findUnique({ where: { code: code.toUpperCase() } });
    return row ? toRecord(row) : null;
  }

  async findById(id: string): Promise<InviteCodeRecord | null> {
    const row = await this.prisma.inviteCode.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async list(): Promise<InviteCodeRecord[]> {
    const rows = await this.prisma.inviteCode.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(toRecord);
  }

  async listRedemptions(codeIds: readonly string[]): Promise<InviteRedemptionRecord[]> {
    if (codeIds.length === 0) return [];
    const rows = await this.prisma.inviteRedemption.findMany({
      where: { codeId: { in: [...codeIds] } },
      orderBy: { redeemedAt: 'asc' },
    });
    return rows.map((r) => ({ codeId: r.codeId, userId: r.userId, redeemedAt: r.redeemedAt }));
  }

  async revoke(id: string): Promise<InviteCodeRecord | null> {
    const existing = await this.prisma.inviteCode.findUnique({ where: { id } });
    if (!existing) return null;
    if (existing.revokedAt) return toRecord(existing);
    const row = await this.prisma.inviteCode.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return toRecord(row);
  }

  async redeem(codeId: string, userId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.inviteCode.findUnique({ where: { id: codeId } });
      if (!current || current.revokedAt) return false;
      if (current.expiresAt && current.expiresAt.getTime() <= Date.now()) return false;
      if (current.usedCount >= current.maxUses) return false;
      // CAS: only increments if nobody else did since the read above.
      const updated = await tx.inviteCode.updateMany({
        where: { id: codeId, usedCount: current.usedCount, revokedAt: null },
        data: { usedCount: { increment: 1 } },
      });
      if (updated.count === 0) return false;
      await tx.inviteRedemption.create({ data: { codeId, userId } });
      return true;
    });
  }
}
