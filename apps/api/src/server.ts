/**
 * Process entry point. Creates the app and binds the port. Validating `env` is a
 * side effect of importing the config, so a misconfigured environment fails here
 * before the server ever accepts a connection.
 */

import { createApp } from '@/app';
import { env } from '@/config/env';
import { logger } from '@/shared/logger';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API listening');
});

// Graceful shutdown so in-flight requests finish and connections close cleanly.
function shutdown(signal: string): void {
  logger.info({ signal }, 'Shutting down');
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
