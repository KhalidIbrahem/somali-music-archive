/**
 * MongoDB connection (SESSION "db-backed repositories", ARCHITECTURE.md §9).
 *
 * Content metadata (recordings, artists) lives in MongoDB. Mongoose models are
 * defined at import time (schema only, no connection), so importing a model is
 * side-effect-free; queries require an open connection, opened at boot via
 * `connectMongo()` when PERSISTENCE=database.
 *
 * Like prisma.ts, this imports neither `@/config/env` nor `@/shared/logger` so
 * recording repository modules stay import-safe in the env-light seed/promote
 * scripts. The caller (server.ts) supplies the URI and does the logging.
 */

import mongoose from 'mongoose';

let connected = false;

/** Open the shared Mongoose connection (idempotent). URI comes from MONGODB_URI. */
export async function connectMongo(uri: string): Promise<void> {
  if (connected) return;
  // Fail fast instead of buffering queries forever against a dead connection.
  mongoose.set('bufferCommands', false);
  // Bound server selection well under any serverless max duration: a blocked
  // Atlas (IP allowlist) must surface as a named boot failure, not a hung
  // cold start that the platform kills into an anonymous 500.
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 6000 });
  connected = true;
}

/** Close the connection on graceful shutdown. */
export async function disconnectMongo(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}
