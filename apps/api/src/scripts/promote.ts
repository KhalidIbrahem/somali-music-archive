/**
 * Change a user's role (SESSION "admin promote", extended for the real database).
 *
 *   npm run promote -- professor@university.edu educator
 *   npm run promote -- admin@somalimusicarchive.com admin
 *
 * Where it acts depends on the persistence mode in `.env` (same switch the API
 * uses): PERSISTENCE=database updates the row in Postgres via Prisma — including
 * the PRODUCTION database when POSTGRES_URL points there — otherwise it edits
 * the local dev store (`npm run seed` state). Roles come from the shared
 * USER_ROLES list, so `educator` is grantable the moment it exists.
 */

import { USER_ROLES, type UserRole } from '@sma/types';
import { loadEnvFile } from '@/config/loadEnv';
import { loadDevStore, saveDevStore } from '@/shared/devStore/devStore';

function isRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

function fail(message: string): never {
  // eslint-disable-next-line no-console
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function promoteInDatabase(email: string, role: UserRole): Promise<void> {
  // Imported lazily so the dev-store path never needs a Prisma client.
  const { getPrisma } = await import('@/shared/db/prisma');
  const prisma = getPrisma();
  try {
    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
    });
    if (!user) fail(`No user found with email "${email}" in the database.`);
    if (user.role === role) {
      // eslint-disable-next-line no-console
      console.log(`• ${user.email} is already "${role}" — no change.`);
      return;
    }
    await prisma.user.update({ where: { id: user.id }, data: { role } });
    // eslint-disable-next-line no-console
    console.log(`✓ ${user.email}: role ${user.role} → ${role} (database)`);
  } finally {
    await prisma.$disconnect();
  }
}

function promoteInDevStore(email: string, role: UserRole): void {
  const store = loadDevStore();
  if (!store) {
    fail('No dev store found. Run `npm run seed` first.');
  }

  const user = store.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    fail(`No user found with email "${email}".`);
  }

  const previous = user.role;
  if (previous === role) {
    // eslint-disable-next-line no-console
    console.log(`• ${user.email} is already "${role}" — no change.`);
    return;
  }

  user.role = role;
  user.updatedAt = new Date();
  saveDevStore(store);

  // eslint-disable-next-line no-console
  console.log(`✓ ${user.email}: role ${previous} → ${role} (dev store)`);
}

async function main(): Promise<void> {
  const [email, role] = process.argv.slice(2);

  if (!email || !role) {
    fail(`Usage: npm run promote -- <email> <${USER_ROLES.join('|')}>`);
  }
  if (!isRole(role)) {
    fail(`Invalid role "${role}". Choose one of: ${USER_ROLES.join(', ')}.`);
  }

  // Same resolution the API uses: .env fills the gaps, real env always wins.
  loadEnvFile();
  if (process.env['PERSISTENCE'] === 'database') {
    if (!process.env['POSTGRES_URL']) {
      fail('PERSISTENCE=database but POSTGRES_URL is not set.');
    }
    await promoteInDatabase(email, role);
  } else {
    promoteInDevStore(email, role);
  }
}

await main();
