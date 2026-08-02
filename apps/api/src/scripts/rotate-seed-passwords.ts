/**
 * Rotate the shared seed password on the migrated seed accounts (SESSION P5-01).
 *
 *   PERSISTENCE=database npm run rotate:seed-passwords
 *
 * The seed accounts were created with a shared password that is committed in
 * seed.ts, so it must never survive to a public deploy. This script generates a
 * fresh random password per account, hashes it with the same bcrypt(12) policy
 * as registration, and updates the live Postgres rows. Each new password is
 * printed ONCE to stdout — store it in a password manager and change it via the
 * normal reset flow afterwards.
 */

import '@/config/bootstrapEnv'; // load .env — deliberately NOT @/config/env (it throws)
import { randomBytes } from 'node:crypto';
import { hashPassword } from '@/modules/auth/password.service';
import { useDatabase } from '@/shared/db/driver';
import { getPrisma, disconnectPrisma } from '@/shared/db/prisma';

/* eslint-disable no-console -- operator-facing CLI script */

const SEED_EMAILS = ['admin@somalimusicarchive.com', 'khalid@somalimusicarchive.com'] as const;

/** ~107 bits of randomness, plus suffix classes to satisfy the password policy. */
function generatePassword(): string {
  return `${randomBytes(13).toString('base64url')}aA1`;
}

async function main(): Promise<void> {
  if (!useDatabase()) {
    console.error('✗ Set PERSISTENCE=database — this script rotates rows in live Postgres.');
    process.exit(1);
  }

  const prisma = getPrisma();
  for (const email of SEED_EMAILS) {
    const password = generatePassword();
    const passwordHash = await hashPassword(password);
    const { count } = await prisma.user.updateMany({ where: { email }, data: { passwordHash } });
    console.log(
      count === 1
        ? `  ✓ ${email} — new password: ${password}`
        : `  △ ${email} — not found, skipped`,
    );
  }
  await disconnectPrisma();
  console.log('\nStore these in a password manager now; they are not shown again.');
}

void main().catch((error: unknown) => {
  console.error('✗ Rotation failed:', error);
  process.exit(1);
});
