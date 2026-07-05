/**
 * PostgreSQL organisation persistence (SESSION P4-02, ARCHITECTURE.md §9).
 *
 * Prisma-backed OrganizationRepository over `organizations` + `organization_members`.
 * Binds in place of the in-memory version when PERSISTENCE=database.
 */

import type {
  Organization as OrganizationRow,
  OrganizationMember as OrganizationMemberRow,
  PrismaClient,
} from '@prisma/client';
import type { OrganizationRole, OrganizationStatus } from '@sma/types';
import type {
  CreateOrganizationRecord,
  OrganizationMemberRecord,
  OrganizationRecord,
  OrganizationRepository,
} from './organizations.repository';

function toOrg(row: OrganizationRow): OrganizationRecord {
  return {
    id: row.id,
    name: row.name,
    licenseKey: row.licenseKey,
    seats: row.seats,
    status: row.status as OrganizationStatus,
    ownerId: row.ownerId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

function toMember(row: OrganizationMemberRow): OrganizationMemberRecord {
  return {
    organizationId: row.organizationId,
    userId: row.userId,
    role: row.role as OrganizationRole,
    joinedAt: row.joinedAt,
  };
}

export class PrismaOrganizationRepository implements OrganizationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateOrganizationRecord): Promise<OrganizationRecord> {
    const row = await this.prisma.organization.create({
      data: {
        name: input.name,
        licenseKey: input.licenseKey,
        seats: input.seats,
        ownerId: input.ownerId,
        expiresAt: input.expiresAt,
      },
    });
    return toOrg(row);
  }

  async findById(id: string): Promise<OrganizationRecord | null> {
    const row = await this.prisma.organization.findUnique({ where: { id } });
    return row ? toOrg(row) : null;
  }

  async findByLicenseKey(licenseKey: string): Promise<OrganizationRecord | null> {
    const row = await this.prisma.organization.findUnique({ where: { licenseKey } });
    return row ? toOrg(row) : null;
  }

  async countMembers(organizationId: string): Promise<number> {
    return this.prisma.organizationMember.count({ where: { organizationId } });
  }

  async addMember(
    organizationId: string,
    userId: string,
    role: OrganizationRole = 'member',
  ): Promise<void> {
    await this.prisma.organizationMember.create({ data: { organizationId, userId, role } });
  }

  async removeMember(organizationId: string, userId: string): Promise<boolean> {
    const result = await this.prisma.organizationMember.deleteMany({
      where: { organizationId, userId },
    });
    return result.count > 0;
  }

  async listMembers(organizationId: string): Promise<OrganizationMemberRecord[]> {
    const rows = await this.prisma.organizationMember.findMany({
      where: { organizationId },
      orderBy: { joinedAt: 'asc' },
    });
    return rows.map(toMember);
  }

  async findMembershipForUser(
    userId: string,
  ): Promise<{ org: OrganizationRecord; role: OrganizationRole } | null> {
    const member = await this.prisma.organizationMember.findUnique({
      where: { userId },
      include: { organization: true },
    });
    if (!member) return null;
    return { org: toOrg(member.organization), role: member.role as OrganizationRole };
  }
}
