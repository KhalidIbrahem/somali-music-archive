/**
 * Test-only helper (SESSION "private access"): registration is invite-gated,
 * so route-level tests that call POST /auth/register through the real app must
 * first mint a code in the singleton in-memory invite repository. Each vitest
 * file gets its own module graph, hence its own singleton to seed.
 */

import { inviteRepository } from '@/modules/invites/invite.repository';

export const TEST_INVITE_CODE = 'QG-TEST-SUITE';

/** Idempotently create a many-use invite for the current test file. */
export async function seedTestInvite(): Promise<string> {
  const existing = await inviteRepository.findByCode(TEST_INVITE_CODE);
  if (!existing) {
    await inviteRepository.create({
      code: TEST_INVITE_CODE,
      label: 'test suite',
      maxUses: 1000,
      expiresAt: null,
      createdById: 'test-admin',
    });
  }
  return TEST_INVITE_CODE;
}
