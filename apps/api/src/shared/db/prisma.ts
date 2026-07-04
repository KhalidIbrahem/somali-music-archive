/**
 * PostgreSQL client (SESSION "db-backed repositories", ARCHITECTURE.md §9).
 *
 * A single lazily-constructed PrismaClient, shared by every Postgres-backed
 * repository. Construction does not open a connection — Prisma connects lazily on
 * the first query (or eagerly via `connectPrisma()` at boot for fail-fast) — so
 * importing this module is side-effect-free. The datasource URL comes from
 * POSTGRES_URL (prisma/schema.prisma).
 *
 * Deliberately imports neither `@/config/env` nor `@/shared/logger` (both validate
 * the full environment on import): repository modules import this at load time and
 * must stay usable in the env-light seed/promote scripts. Connection logging is
 * the caller's job (server.ts).
 */

import { PrismaClient } from '@prisma/client';

let client: PrismaClient | null = null;

/** The process-wide Prisma client, created on first use. */
export function getPrisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient({ log: ['warn', 'error'] });
  }
  return client;
}

/** Eagerly open the connection so a bad POSTGRES_URL fails at boot, not mid-request. */
export async function connectPrisma(): Promise<void> {
  await getPrisma().$connect();
}

/** Close the connection on graceful shutdown. */
export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
