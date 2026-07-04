/**
 * PostgreSQL client (SESSION "db-backed repositories", ARCHITECTURE.md §9).
 *
 * A single lazily-constructed PrismaClient, shared by every Postgres-backed
 * repository. Construction does not open a connection — Prisma connects lazily on
 * the first query (or eagerly via `connectPrisma()` at boot for fail-fast) — so
 * importing this module is side-effect-free and safe even when no database is
 * configured. The datasource URL comes from POSTGRES_URL (prisma/schema.prisma).
 */

import { PrismaClient } from '@prisma/client';
import { env } from '@/config/env';
import { logger } from '@/shared/logger';

let client: PrismaClient | null = null;

/** The process-wide Prisma client, created on first use. */
export function getPrisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient({
      log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return client;
}

/** Eagerly open the connection so a bad POSTGRES_URL fails at boot, not mid-request. */
export async function connectPrisma(): Promise<void> {
  await getPrisma().$connect();
  logger.info('Postgres (Prisma) connected');
}

/** Close the connection on graceful shutdown. */
export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
