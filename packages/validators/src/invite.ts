/**
 * Invite schemas (SESSION "private access") — every /invites API input
 * validates here (CONVENTIONS.md hard rule).
 */

import { z } from 'zod';

/** Body of POST /invites — an admin minting a code. */
export const inviteCreateSchema = z.object({
  /** Who this code is for — shown only in the admin panel. */
  label: z.string().trim().max(120).optional(),
  /** How many registrations one code admits (a seminar can share a code). */
  maxUses: z.coerce.number().int().min(1).max(500).default(1),
  /** Days until the code expires; omitted → never expires. */
  expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
});

export type InviteCreateInput = z.infer<typeof inviteCreateSchema>;
