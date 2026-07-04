/**
 * MongoDB connection (SESSION "db-backed repositories", ARCHITECTURE.md §9).
 *
 * Content metadata (recordings, artists) lives in MongoDB. Mongoose models are
 * defined at import time (schema only, no connection), so importing a model is
 * side-effect-free; queries require an open connection, opened at boot via
 * `connectMongo()` when PERSISTENCE=database. The URI comes from MONGODB_URI.
 */

import mongoose from 'mongoose';
import { env } from '@/config/env';
import { logger } from '@/shared/logger';

let connected = false;

/** Open the shared Mongoose connection (idempotent). */
export async function connectMongo(): Promise<void> {
  if (connected) return;
  // Fail fast instead of buffering queries forever against a dead connection.
  mongoose.set('bufferCommands', false);
  await mongoose.connect(env.MONGODB_URI);
  connected = true;
  logger.info('MongoDB (Mongoose) connected');
}

/** Close the connection on graceful shutdown. */
export async function disconnectMongo(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}
