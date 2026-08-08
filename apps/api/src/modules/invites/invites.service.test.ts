import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryUserRepository } from '@/modules/auth/user.repository';
import { InMemoryInviteRepository } from './invite.repository';
import {
  createInvitesService,
  generateInviteCode,
  inviteStatus,
  type InvitesService,
} from './invites.service';

let repo: InMemoryInviteRepository;
let users: InMemoryUserRepository;
let service: InvitesService;

beforeEach(() => {
  repo = new InMemoryInviteRepository();
  users = new InMemoryUserRepository();
  service = createInvitesService({ invites: repo, users });
});

describe('generateInviteCode', () => {
  it('produces branded, unambiguous codes', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateInviteCode();
      expect(code).toMatch(/^QG-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
      // The confusable characters are excluded outright.
      expect(code).not.toMatch(/[01OIL]/);
    }
  });
});

describe('createInvite / listInvites / revokeInvite', () => {
  it('mints a single-use code by default and lists it as active', async () => {
    const created = await service.createInvite('admin-1', { label: 'MIT faculty', maxUses: 1 });
    expect(created.status).toBe('active');
    expect(created.maxUses).toBe(1);
    const listed = await service.listInvites();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.label).toBe('MIT faculty');
  });

  it('applies expiresInDays and reports expiry', async () => {
    const created = await service.createInvite('admin-1', { maxUses: 1, expiresInDays: 7 });
    expect(created.expiresAt).not.toBeNull();
    const record = await repo.findByCode(created.code);
    expect(record && inviteStatus(record)).toBe('active');
    // A record already past its expiry reads as expired.
    if (record) record.expiresAt = new Date(Date.now() - 1000);
    expect(record && inviteStatus(record)).toBe('expired');
  });

  it('revokes a code and keeps it in the listing as history', async () => {
    const created = await service.createInvite('admin-1', { maxUses: 3 });
    const revoked = await service.revokeInvite(created.id);
    expect(revoked.status).toBe('revoked');
    const listed = await service.listInvites();
    expect(listed[0]?.status).toBe('revoked');
  });

  it('resolves redeemer identities in the listing', async () => {
    const member = await users.create({
      email: 'professor@university.edu',
      passwordHash: 'x',
      displayName: 'Guest Professor',
      language: 'en',
    });
    const created = await service.createInvite('admin-1', { maxUses: 2 });
    const record = await repo.findByCode(created.code);
    expect(record).not.toBeNull();
    if (record) await repo.redeem(record.id, member.id);
    const listed = await service.listInvites();
    expect(listed[0]?.usedCount).toBe(1);
    expect(listed[0]?.redemptions[0]).toMatchObject({
      email: 'professor@university.edu',
      displayName: 'Guest Professor',
    });
  });
});

describe('checkCode', () => {
  it('gives person-friendly reasons for each dead state', async () => {
    await expect(service.checkCode('QG-NOPE-NOPE')).rejects.toMatchObject({
      code: 'AUTH_INVITE_INVALID',
      message: expect.stringContaining('not recognised') as string,
    });

    const revoked = await service.createInvite('admin-1', { maxUses: 1 });
    await service.revokeInvite(revoked.id);
    await expect(service.checkCode(revoked.code)).rejects.toMatchObject({
      message: expect.stringContaining('revoked') as string,
    });

    const exhausted = await service.createInvite('admin-1', { maxUses: 1 });
    const record = await repo.findByCode(exhausted.code);
    if (record) await repo.redeem(record.id, 'someone');
    await expect(service.checkCode(exhausted.code)).rejects.toMatchObject({
      message: expect.stringContaining('maximum number of times') as string,
    });
  });

  it('returns the record for a live code', async () => {
    const created = await service.createInvite('admin-1', { maxUses: 2 });
    const record = await service.checkCode(created.code);
    expect(record.code).toBe(created.code);
  });
});

describe('redeem concurrency contract', () => {
  it('never over-admits: N parallel redemptions on maxUses=1 admit exactly one', async () => {
    const created = await service.createInvite('admin-1', { maxUses: 1 });
    const record = await repo.findByCode(created.code);
    expect(record).not.toBeNull();
    if (!record) return;
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => repo.redeem(record.id, `user-${i}`)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
