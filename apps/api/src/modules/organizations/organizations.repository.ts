/**
 * Organisation persistence (SESSION P4-02, ARCHITECTURE.md §16 Phase 4).
 *
 * An organisation holds an institutional license (seat count + shareable key); a
 * separate member row per seat holder, with a one-org-per-user constraint. The
 * owner (the admin who issued the license) is tracked by `ownerId` and does NOT
 * occupy a seat — seats are for the institution's members. Interface-first
 * (ADR-0005): the singleton binds to Prisma when PERSISTENCE=database, else in-memory.
 */

import type { OrganizationRole, OrganizationStatus } from '@sma/types';
import { randomUUID } from '@/shared/crypto';
import { useDatabase } from '@/shared/db/driver';
import { getPrisma } from '@/shared/db/prisma';
import { PrismaOrganizationRepository } from './organizations.prisma.repository';

export interface OrganizationRecord {
  id: string;
  name: string;
  licenseKey: string;
  seats: number;
  status: OrganizationStatus;
  ownerId: string;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface OrganizationMemberRecord {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  joinedAt: Date;
}

export interface CreateOrganizationRecord {
  name: string;
  licenseKey: string;
  seats: number;
  ownerId: string;
  expiresAt: Date | null;
}

export interface OrganizationRepository {
  create(input: CreateOrganizationRecord): Promise<OrganizationRecord>;
  findById(id: string): Promise<OrganizationRecord | null>;
  findByLicenseKey(licenseKey: string): Promise<OrganizationRecord | null>;
  countMembers(organizationId: string): Promise<number>;
  addMember(organizationId: string, userId: string, role?: OrganizationRole): Promise<void>;
  removeMember(organizationId: string, userId: string): Promise<boolean>;
  listMembers(organizationId: string): Promise<OrganizationMemberRecord[]>;
  /** The single org (+ role) a user belongs to, or null. */
  findMembershipForUser(
    userId: string,
  ): Promise<{ org: OrganizationRecord; role: OrganizationRole } | null>;
}

export class InMemoryOrganizationRepository implements OrganizationRepository {
  private readonly orgs = new Map<string, OrganizationRecord>();
  private readonly members: OrganizationMemberRecord[] = [];

  async create(input: CreateOrganizationRecord): Promise<OrganizationRecord> {
    const record: OrganizationRecord = {
      id: randomUUID(),
      name: input.name,
      licenseKey: input.licenseKey,
      seats: input.seats,
      status: 'active',
      ownerId: input.ownerId,
      expiresAt: input.expiresAt,
      createdAt: new Date(),
    };
    this.orgs.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<OrganizationRecord | null> {
    return this.orgs.get(id) ?? null;
  }

  async findByLicenseKey(licenseKey: string): Promise<OrganizationRecord | null> {
    return [...this.orgs.values()].find((o) => o.licenseKey === licenseKey) ?? null;
  }

  async countMembers(organizationId: string): Promise<number> {
    return this.members.filter((m) => m.organizationId === organizationId).length;
  }

  async addMember(
    organizationId: string,
    userId: string,
    role: OrganizationRole = 'member',
  ): Promise<void> {
    this.members.push({ organizationId, userId, role, joinedAt: new Date() });
  }

  async removeMember(organizationId: string, userId: string): Promise<boolean> {
    const index = this.members.findIndex(
      (m) => m.organizationId === organizationId && m.userId === userId,
    );
    if (index < 0) return false;
    this.members.splice(index, 1);
    return true;
  }

  async listMembers(organizationId: string): Promise<OrganizationMemberRecord[]> {
    return this.members
      .filter((m) => m.organizationId === organizationId)
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  }

  async findMembershipForUser(
    userId: string,
  ): Promise<{ org: OrganizationRecord; role: OrganizationRole } | null> {
    const member = this.members.find((m) => m.userId === userId);
    if (!member) return null;
    const org = this.orgs.get(member.organizationId);
    return org ? { org, role: member.role } : null;
  }
}

export const organizationRepository: OrganizationRepository = useDatabase()
  ? new PrismaOrganizationRepository(getPrisma())
  : new InMemoryOrganizationRepository();
