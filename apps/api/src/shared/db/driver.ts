/**
 * Persistence driver selection (SESSION "db-backed repositories").
 *
 * Decides whether the repository singletons bind to the real databases
 * (Prisma/Postgres + Mongoose/Mongo) or the in-memory implementations. The flag is
 * read DIRECTLY from `process.env` rather than through `@/config/env` on purpose:
 * repository modules call `useDatabase()` at import time, and they must stay
 * importable in the env-light script contexts (scripts/seed.ts, scripts/promote.ts)
 * that never populate the full validated environment. `@/config/env` still declares
 * `PERSISTENCE` so the server validates and documents it.
 *
 * Tests always use in-memory (NODE_ENV=test) regardless of the flag, so the suite
 * never needs a database.
 */

/** True when the repositories should use the real databases. */
export function useDatabase(): boolean {
  return process.env['NODE_ENV'] !== 'test' && process.env['PERSISTENCE'] === 'database';
}
