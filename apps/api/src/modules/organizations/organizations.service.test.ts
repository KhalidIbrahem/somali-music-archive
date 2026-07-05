import { describe, it, expect, beforeEach } from 'vitest';
import { AppError } from '@/shared/errors/AppError';
import { InMemoryOrganizationRepository } from './organizations.repository';
import { createOrganizationsService, type OrganizationsService } from './organizations.service';

const ADMIN = 'admin-1';

let repo: InMemoryOrganizationRepository;
let service: OrganizationsService;

beforeEach(() => {
  repo = new InMemoryOrganizationRepository();
  service = createOrganizationsService({ repo });
});

/** Create an org via the service and return its id + license key. */
async function makeOrg(seats: number): Promise<{ id: string; licenseKey: string }> {
  const org = await service.createOrganization(ADMIN, { name: 'University of X', seats });
  return { id: org.id, licenseKey: org.licenseKey };
}

describe('createOrganization', () => {
  it('issues a license with a shareable key and zero seats used', async () => {
    const org = await service.createOrganization(ADMIN, { name: 'Uni', seats: 5 });
    expect(org.licenseKey).toMatch(/^SMA-INST-/);
    expect(org.seats).toBe(5);
    expect(org.seatsUsed).toBe(0);
    expect(org.status).toBe('active');
  });
});

describe('joinOrganization', () => {
  it('claims a seat and grants entitlement', async () => {
    const { licenseKey } = await makeOrg(2);

    const membership = await service.joinOrganization('u1', licenseKey);
    expect(membership.role).toBe('member');
    expect(membership.organization.seatsUsed).toBe(1);
    expect(await service.hasActiveSeat('u1')).toBe(true);
  });

  it('rejects an unknown license key', async () => {
    await expect(service.joinOrganization('u1', 'SMA-INST-NOPE')).rejects.toBeInstanceOf(AppError);
  });

  it('rejects joining twice / belonging to two orgs', async () => {
    const { licenseKey } = await makeOrg(5);
    await service.joinOrganization('u1', licenseKey);
    await expect(service.joinOrganization('u1', licenseKey)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects when there are no free seats', async () => {
    const { licenseKey } = await makeOrg(1);
    await service.joinOrganization('u1', licenseKey);
    await expect(service.joinOrganization('u2', licenseKey)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects an expired license', async () => {
    const org = await repo.create({
      name: 'Old',
      licenseKey: 'SMA-INST-EXPIRED',
      seats: 5,
      ownerId: ADMIN,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(service.joinOrganization('u1', org.licenseKey)).rejects.toBeInstanceOf(AppError);
  });
});

describe('leaveOrganization', () => {
  it('frees the seat', async () => {
    const { licenseKey } = await makeOrg(1);
    await service.joinOrganization('u1', licenseKey);

    await service.leaveOrganization('u1');
    expect(await service.hasActiveSeat('u1')).toBe(false);
    // The freed seat is reusable.
    await expect(service.joinOrganization('u2', licenseKey)).resolves.toBeDefined();
  });

  it('rejects leaving when not in an org', async () => {
    await expect(service.leaveOrganization('nobody')).rejects.toBeInstanceOf(AppError);
  });
});

describe('member management (owner-only)', () => {
  it('lets the owner list and remove members', async () => {
    const { id, licenseKey } = await makeOrg(5);
    await service.joinOrganization('u1', licenseKey);

    const members = await service.listMembers(ADMIN, id);
    expect(members.map((m) => m.userId)).toContain('u1');

    await service.removeMember(ADMIN, id, 'u1');
    expect(await service.hasActiveSeat('u1')).toBe(false);
  });

  it('forbids a non-owner from managing members', async () => {
    const { id, licenseKey } = await makeOrg(5);
    await service.joinOrganization('u1', licenseKey);
    await expect(service.listMembers('someone-else', id)).rejects.toBeInstanceOf(AppError);
    await expect(service.removeMember('u1', id, 'u1')).rejects.toBeInstanceOf(AppError);
  });

  it('404s removing an unknown member', async () => {
    const { id } = await makeOrg(5);
    await expect(service.removeMember(ADMIN, id, 'ghost')).rejects.toBeInstanceOf(AppError);
  });
});

describe('getMyMembership / getOrganization', () => {
  it('returns membership for a member and null otherwise', async () => {
    const { licenseKey } = await makeOrg(5);
    await service.joinOrganization('u1', licenseKey);
    expect((await service.getMyMembership('u1'))?.role).toBe('member');
    expect(await service.getMyMembership('u2')).toBeNull();
  });

  it('lets the owner and members read the org but forbids strangers', async () => {
    const { id, licenseKey } = await makeOrg(5);
    await service.joinOrganization('u1', licenseKey);

    expect((await service.getOrganization(id, ADMIN)).id).toBe(id); // owner
    expect((await service.getOrganization(id, 'u1')).id).toBe(id); // member
    await expect(service.getOrganization(id, 'stranger')).rejects.toBeInstanceOf(AppError);
  });
});
