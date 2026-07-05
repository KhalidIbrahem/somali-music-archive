/**
 * Organisations service (SESSION P4-02, ARCHITECTURE.md §16 Phase 4).
 *
 * The institutional-license flow: an admin issues a license (an org + a shareable
 * key), users claim seats with the key, and the owner manages membership. Exposes
 * `hasActiveSeat` so the subscriptions service can grant institutional-tier
 * entitlement to seat holders without this module knowing about billing.
 *
 * Injected repository (ADR-0005) so every branch is unit-testable in-memory.
 */

import { randomBytes } from 'node:crypto';
import type {
  CreatedOrganization,
  OrganizationMembership,
  OrganizationMemberView,
  PublicOrganization,
} from '@sma/types';
import type { CreateOrganizationInput } from '@sma/validators';
import { asIso, asUuid } from '@/shared/brand';
import { badRequest, forbidden, notFound } from '@/shared/errors/AppError';
import {
  organizationRepository,
  type OrganizationRecord,
  type OrganizationRepository,
} from './organizations.repository';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A shareable, human-distributable enrolment code (not a per-user secret). */
function generateLicenseKey(): string {
  return `SMA-INST-${randomBytes(8).toString('hex').toUpperCase()}`;
}

function isExpired(org: OrganizationRecord): boolean {
  return org.expiresAt !== null && org.expiresAt.getTime() <= Date.now();
}

/** Active = the license is switched on and not past its expiry. */
function isActive(org: OrganizationRecord): boolean {
  return org.status === 'active' && !isExpired(org);
}

function toPublicOrganization(org: OrganizationRecord, seatsUsed: number): PublicOrganization {
  return {
    id: asUuid(org.id),
    name: org.name,
    seats: org.seats,
    seatsUsed,
    status: isExpired(org) ? 'expired' : org.status,
    createdAt: asIso(org.createdAt),
    ...(org.expiresAt ? { expiresAt: asIso(org.expiresAt) } : {}),
  };
}

export function createOrganizationsService(deps: { repo: OrganizationRepository }) {
  const { repo } = deps;

  async function createOrganization(
    ownerId: string,
    input: CreateOrganizationInput,
  ): Promise<CreatedOrganization> {
    const org = await repo.create({
      name: input.name,
      licenseKey: generateLicenseKey(),
      seats: input.seats,
      ownerId,
      expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * DAY_MS) : null,
    });
    return { ...toPublicOrganization(org, 0), licenseKey: org.licenseKey };
  }

  async function getOrganization(id: string, userId: string): Promise<PublicOrganization> {
    const org = await repo.findById(id);
    if (!org) throw notFound('NOT_FOUND', 'Organization not found');
    const membership = await repo.findMembershipForUser(userId);
    if (org.ownerId !== userId && membership?.org.id !== id) throw forbidden();
    return toPublicOrganization(org, await repo.countMembers(id));
  }

  async function joinOrganization(
    userId: string,
    licenseKey: string,
  ): Promise<OrganizationMembership> {
    const org = await repo.findByLicenseKey(licenseKey.trim());
    if (!org) throw notFound('NOT_FOUND', 'License key not found');
    if (!isActive(org)) throw badRequest('VALIDATION_ERROR', 'This license is not active');
    if (await repo.findMembershipForUser(userId)) {
      throw badRequest('VALIDATION_ERROR', 'You already belong to an organization');
    }
    const seatsUsed = await repo.countMembers(org.id);
    if (seatsUsed >= org.seats) {
      throw badRequest('VALIDATION_ERROR', 'This organization has no free seats');
    }
    await repo.addMember(org.id, userId, 'member');
    return { organization: toPublicOrganization(org, seatsUsed + 1), role: 'member' };
  }

  async function leaveOrganization(userId: string): Promise<void> {
    const membership = await repo.findMembershipForUser(userId);
    if (!membership) throw badRequest('VALIDATION_ERROR', 'You are not in an organization');
    await repo.removeMember(membership.org.id, userId);
  }

  async function removeMember(
    callerId: string,
    organizationId: string,
    targetUserId: string,
  ): Promise<void> {
    const org = await repo.findById(organizationId);
    if (!org) throw notFound('NOT_FOUND', 'Organization not found');
    if (org.ownerId !== callerId) throw forbidden();
    const removed = await repo.removeMember(organizationId, targetUserId);
    if (!removed) throw notFound('NOT_FOUND', 'Member not found');
  }

  async function listMembers(
    callerId: string,
    organizationId: string,
  ): Promise<OrganizationMemberView[]> {
    const org = await repo.findById(organizationId);
    if (!org) throw notFound('NOT_FOUND', 'Organization not found');
    if (org.ownerId !== callerId) throw forbidden();
    const members = await repo.listMembers(organizationId);
    return members.map((m) => ({
      userId: asUuid(m.userId),
      role: m.role,
      joinedAt: asIso(m.joinedAt),
    }));
  }

  async function getMyMembership(userId: string): Promise<OrganizationMembership | null> {
    const membership = await repo.findMembershipForUser(userId);
    if (!membership) return null;
    const seatsUsed = await repo.countMembers(membership.org.id);
    return { organization: toPublicOrganization(membership.org, seatsUsed), role: membership.role };
  }

  /** True when the user occupies a seat in an active license (entitlement source). */
  async function hasActiveSeat(userId: string): Promise<boolean> {
    const membership = await repo.findMembershipForUser(userId);
    return membership !== null && isActive(membership.org);
  }

  return {
    createOrganization,
    getOrganization,
    joinOrganization,
    leaveOrganization,
    removeMember,
    listMembers,
    getMyMembership,
    hasActiveSeat,
  };
}

export type OrganizationsService = ReturnType<typeof createOrganizationsService>;

export const organizationsService: OrganizationsService = createOrganizationsService({
  repo: organizationRepository,
});
