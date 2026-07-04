/**
 * Local development seed store (SESSION "seed data").
 *
 * A dev-only JSON file that stands in for a database so `npm run seed` /
 * `npm run promote` produce state the running API can actually load — the real
 * persistence layer (Postgres users, Mongo recordings) is not wired yet, and the
 * in-memory repositories reset every process. This is the seam described by
 * ADR-0005: when the DB-backed repositories land, this file and the boot-time
 * hydration are deleted, and nothing else changes.
 *
 * Deliberately env-free (no `@/config/env` import) so the seed/promote scripts run
 * without a populated `.env`. The store is written to `.data/` (git-ignored) and
 * is never used in production (the bootstrap guards on NODE_ENV).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { UserRecord } from '@/modules/auth/user.repository';
import type { RecordingDoc } from '@/modules/recordings/recordings.repository';

/** The complete dev snapshot: everything a fresh API process needs to look seeded. */
export interface DevStoreData {
  users: UserRecord[];
  recordings: RecordingDoc[];
}

/** File location, relative to the api package root (scripts run from apps/api). */
export const DEV_STORE_PATH = resolve(process.cwd(), '.data', 'dev-store.json');

/** Date-valued fields to revive from ISO strings after JSON.parse. */
const USER_DATE_KEYS = [
  'emailVerifiedAt',
  'lastLoginAt',
  'lockedUntil',
  'createdAt',
  'updatedAt',
  'deletedAt',
] as const;
const RECORDING_DATE_KEYS = ['aiProcessedAt', 'createdAt', 'updatedAt', 'deletedAt'] as const;

/**
 * Rebuild `Date` instances from the ISO strings JSON.stringify produced, so the
 * repositories receive the exact record shape they store internally.
 */
function reviveDates<T>(rows: readonly unknown[], keys: readonly string[]): T[] {
  return rows.map((row) => {
    const obj = { ...(row as Record<string, unknown>) };
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'string') obj[key] = new Date(value);
    }
    return obj as T;
  });
}

/** Read the dev store, or `null` if it has not been seeded yet. */
export function loadDevStore(): DevStoreData | null {
  if (!existsSync(DEV_STORE_PATH)) return null;
  const parsed = JSON.parse(readFileSync(DEV_STORE_PATH, 'utf8')) as {
    users?: unknown[];
    recordings?: unknown[];
  };
  return {
    users: reviveDates<UserRecord>(parsed.users ?? [], USER_DATE_KEYS),
    recordings: reviveDates<RecordingDoc>(parsed.recordings ?? [], RECORDING_DATE_KEYS),
  };
}

/** Write the dev store, creating the `.data/` directory if needed. */
export function saveDevStore(data: DevStoreData): void {
  mkdirSync(dirname(DEV_STORE_PATH), { recursive: true });
  writeFileSync(DEV_STORE_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
