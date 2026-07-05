/**
 * Process entry point. Creates the app and binds the port. Validating `env` is a
 * side effect of importing the config, so a misconfigured environment fails here
 * before the server ever accepts a connection.
 */

// Must be first: loads .env into process.env before @/config/env validates it.
import '@/config/bootstrapEnv';
import { createApp } from '@/app';
import { env } from '@/config/env';
import { logger } from '@/shared/logger';
import { hydrateFromDevStore } from '@/shared/devStore/bootstrap';
import { connectPrisma, disconnectPrisma } from '@/shared/db/prisma';
import { connectMongo, disconnectMongo } from '@/shared/db/mongoose';

const usingDatabase = env.PERSISTENCE === 'database';

async function start(): Promise<void> {
  if (usingDatabase) {
    // Open the database connections up front so a bad URL fails at boot, not
    // mid-request. In-memory mode never touches them.
    await connectPrisma();
    logger.info('Postgres (Prisma) connected');
    await connectMongo(env.MONGODB_URI);
    logger.info('MongoDB (Mongoose) connected');
  } else {
    // Dev-only: load `npm run seed` data into the in-memory repositories so a
    // fresh process looks seeded. No-op in production and when nothing was seeded.
    await hydrateFromDevStore();
  }

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, persistence: env.PERSISTENCE },
      'API listening',
    );
  });

  // Graceful shutdown so in-flight requests finish and connections close cleanly.
  function shutdown(signal: string): void {
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      void Promise.all([disconnectPrisma(), disconnectMongo()]).finally(() => process.exit(0));
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void start().catch((error: unknown) => {
  logger.error({ err: error }, 'Fatal error during startup');
  process.exit(1);
});
