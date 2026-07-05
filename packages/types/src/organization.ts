/**
 * Institutional license contracts (ARCHITECTURE.md §16 Phase 4, SESSION P4-02).
 *
 * An organisation holds an institutional license with a fixed number of seats. A
 * platform admin issues the license (creating the org + a shareable license key);
 * users join with that key, each consuming a seat and gaining institutional-tier
 * entitlement for as long as their membership and the license are active.
 */

import type { IsoDateTimeString, Uuid } from './common';

export type OrganizationStatus = 'active' | 'suspended' | 'expired';
export type OrganizationRole = 'owner' | 'member';

/** An organisation as shown to its owner or members (never includes internals). */
export interface PublicOrganization {
  readonly id: Uuid;
  readonly name: string;
  /** Total seats the license grants. */
  readonly seats: number;
  /** Seats currently taken (member count). */
  readonly seatsUsed: number;
  readonly status: OrganizationStatus;
  readonly expiresAt?: IsoDateTimeString;
  readonly createdAt: IsoDateTimeString;
}

/** Returned once at creation — carries the license key for the admin to distribute. */
export interface CreatedOrganization extends PublicOrganization {
  readonly licenseKey: string;
}

/** A member row as shown to the org owner. */
export interface OrganizationMemberView {
  readonly userId: Uuid;
  readonly role: OrganizationRole;
  readonly joinedAt: IsoDateTimeString;
}

/** A user's membership: the org plus their role in it. */
export interface OrganizationMembership {
  readonly organization: PublicOrganization;
  readonly role: OrganizationRole;
}
