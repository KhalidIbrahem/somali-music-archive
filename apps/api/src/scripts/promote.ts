/**
 * Change a user's role in the dev store (SESSION "admin promote").
 *
 *   npm run promote -- admin@somalimusicarchive.com admin
 *   npm run promote -- someone@example.com contributor
 *
 * Validates the email exists and the target role is one of listener | contributor
 * | admin, updates the dev store, and prints a confirmation. Operates on the same
 * file-backed dev store as `npm run seed` (env-free — no `.env` required). When the
 * real user database is wired, this is reimplemented as a query against it.
 */

import type { UserRole } from '@sma/types';
import { loadDevStore, saveDevStore } from '@/shared/devStore/devStore';

const ROLES: readonly UserRole[] = ['listener', 'contributor', 'admin'];

function isRole(value: string): value is UserRole {
  return (ROLES as readonly string[]).includes(value);
}

function fail(message: string): never {
  // eslint-disable-next-line no-console
  console.error(`✗ ${message}`);
  process.exit(1);
}

function main(): void {
  const [email, role] = process.argv.slice(2);

  if (!email || !role) {
    fail('Usage: npm run promote -- <email> <listener|contributor|admin>');
  }
  if (!isRole(role)) {
    fail(`Invalid role "${role}". Choose one of: ${ROLES.join(', ')}.`);
  }

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
  console.log(`✓ ${user.email}: role ${previous} → ${role}`);
}

main();
