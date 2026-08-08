/**
 * Invites service (SESSION "private access") — minting, listing, revoking, and
 * redeeming the codes that gate registration. Injected repositories (ADR-0005)
 * so every branch is unit-testable without a database.
 */

import { randomBytes } from 'node:crypto';
import type { InviteCodeView, InviteRedemptionView, InviteStatus } from '@sma/types';
import type { InviteCreateInput } from '@sma/validators';
import { AppError, notFound } from '@/shared/errors/AppError';
import { asIso, asUuid } from '@/shared/brand';
import { userRepository } from '@/modules/auth/user.repository';
import {
  inviteRepository,
  type InviteCodeRecord,
  type InviteRepository,
} from './invite.repository';

/** Unambiguous alphabet (no 0/O/1/I/L) — codes get read aloud and typed. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function randomChunk(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[(bytes[i] ?? 0) % CODE_ALPHABET.length];
  }
  return out;
}

/** e.g. QG-7KMP-XW4T — branded, phone-dictation-friendly. */
export function generateInviteCode(): string {
  return `QG-${randomChunk(4)}-${randomChunk(4)}`;
}

export function inviteStatus(record: InviteCodeRecord, now = new Date()): InviteStatus {
  if (record.revokedAt) return 'revoked';
  if (record.expiresAt && record.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (record.usedCount >= record.maxUses) return 'exhausted';
  return 'active';
}

export interface InvitesServiceDeps {
  invites: InviteRepository;
  /** Resolves redeemer identities for the admin panel. */
  users: { findById(id: string): Promise<{ email: string; displayName: string } | null> };
}

function toView(
  record: InviteCodeRecord,
  redemptions: readonly InviteRedemptionView[],
): InviteCodeView {
  return {
    id: asUuid(record.id),
    code: record.code,
    label: record.label,
    maxUses: record.maxUses,
    usedCount: record.usedCount,
    status: inviteStatus(record),
    expiresAt: record.expiresAt ? asIso(record.expiresAt) : null,
    revokedAt: record.revokedAt ? asIso(record.revokedAt) : null,
    createdAt: asIso(record.createdAt),
    redemptions,
  };
}

export function createInvitesService(deps: InvitesServiceDeps) {
  const { invites, users } = deps;

  async function createInvite(actorId: string, input: InviteCreateInput): Promise<InviteCodeView> {
    // Regenerate on the (astronomically unlikely) code collision.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateInviteCode();
      const existing = await invites.findByCode(code);
      if (existing) continue;
      const record = await invites.create({
        code,
        label: input.label?.trim() ? input.label.trim() : null,
        maxUses: input.maxUses,
        expiresAt:
          input.expiresInDays !== undefined
            ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
            : null,
        createdById: actorId,
      });
      return toView(record, []);
    }
    throw new AppError(500, 'INTERNAL_ERROR', 'Could not generate a unique invite code');
  }

  async function listInvites(): Promise<InviteCodeView[]> {
    const records = await invites.list();
    const redemptions = await invites.listRedemptions(records.map((r) => r.id));
    // Resolve each distinct redeemer once.
    const userIds = [...new Set(redemptions.map((r) => r.userId))];
    const resolved = new Map<string, { email: string; displayName: string }>();
    for (const id of userIds) {
      const user = await users.findById(id);
      if (user) resolved.set(id, { email: user.email, displayName: user.displayName });
    }
    return records.map((record) =>
      toView(
        record,
        redemptions
          .filter((r) => r.codeId === record.id)
          .map((r) => ({
            userId: asUuid(r.userId),
            email: resolved.get(r.userId)?.email ?? '(removed member)',
            displayName: resolved.get(r.userId)?.displayName ?? '(removed member)',
            redeemedAt: asIso(r.redeemedAt),
          })),
      ),
    );
  }

  async function revokeInvite(id: string): Promise<InviteCodeView> {
    const record = await invites.revoke(id);
    if (!record) throw notFound('NOT_FOUND', 'Invite code not found');
    return toView(record, []);
  }

  /**
   * Registration-side check. Throws AUTH_INVITE_INVALID with a person-friendly
   * reason — invited guests deserve to know whether to ask for a fresh code.
   * Brute-force probing is already throttled by the auth rate limiter.
   */
  async function checkCode(code: string): Promise<InviteCodeRecord> {
    const record = await invites.findByCode(code);
    if (!record) {
      throw new AppError(400, 'AUTH_INVITE_INVALID', 'This invite code is not recognised');
    }
    switch (inviteStatus(record)) {
      case 'revoked':
        throw new AppError(400, 'AUTH_INVITE_INVALID', 'This invite code has been revoked');
      case 'expired':
        throw new AppError(400, 'AUTH_INVITE_INVALID', 'This invite code has expired');
      case 'exhausted':
        throw new AppError(
          400,
          'AUTH_INVITE_INVALID',
          'This invite code has already been used the maximum number of times',
        );
      case 'active':
        return record;
    }
  }

  /** Burn one use for the newly created member. */
  function redeemFor(codeId: string, userId: string): Promise<boolean> {
    return invites.redeem(codeId, userId);
  }

  return { createInvite, listInvites, revokeInvite, checkCode, redeemFor };
}

export type InvitesService = ReturnType<typeof createInvitesService>;

export const invitesService: InvitesService = createInvitesService({
  invites: inviteRepository,
  users: userRepository,
});
