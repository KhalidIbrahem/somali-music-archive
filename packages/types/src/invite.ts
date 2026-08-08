/**
 * Invite types (SESSION "private access") — the platform is invite-only: an
 * admin mints codes, hands one to a guest (e.g. MIT faculty), and registration
 * requires a live code. Codes support multiple uses (a seminar group can share
 * one) and every redemption is recorded.
 */

import type { IsoDateTimeString, Uuid } from './common';

/** Lifecycle of a code, derived server-side for display. */
export type InviteStatus = 'active' | 'revoked' | 'expired' | 'exhausted';

/** One member who registered with a code. */
export interface InviteRedemptionView {
  readonly userId: Uuid;
  readonly email: string;
  readonly displayName: string;
  readonly redeemedAt: IsoDateTimeString;
}

/** An invite code as the admin panel sees it. The code string itself is only
 * sensitive until used up — it grants registration, nothing else. */
export interface InviteCodeView {
  readonly id: Uuid;
  readonly code: string;
  /** Admin-facing note about who this code was minted for. */
  readonly label: string | null;
  readonly maxUses: number;
  readonly usedCount: number;
  readonly status: InviteStatus;
  readonly expiresAt: IsoDateTimeString | null;
  readonly revokedAt: IsoDateTimeString | null;
  readonly createdAt: IsoDateTimeString;
  readonly redemptions: readonly InviteRedemptionView[];
}
