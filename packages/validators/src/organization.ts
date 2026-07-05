/**
 * Institutional license input schemas (ARCHITECTURE.md §16 Phase 4, SESSION P4-02).
 */

import { z } from 'zod';

/** POST /organizations — a platform admin issues an institutional license. */
export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(120),
  seats: z.coerce.number().int().min(1, 'At least one seat').max(100000),
  /** Optional expiry; omitted = perpetual. */
  expiresInDays: z.coerce.number().int().positive().max(3650).optional(),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/** POST /organizations/join — a user claims a seat with the license key. */
export const joinOrganizationSchema = z.object({
  licenseKey: z.string().trim().min(1, 'A license key is required').max(200),
});
export type JoinOrganizationInput = z.infer<typeof joinOrganizationSchema>;
