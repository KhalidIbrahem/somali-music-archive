/**
 * Vercel serverless entry (deploy target: web on Vercel + this API as a single
 * Vercel function; see apps/api/vercel.json).
 *
 * Unlike server.ts this never binds a port — Vercel invokes the exported
 * Express app per request. Module scope runs once per lambda instance and is
 * cached across warm invocations, so the database/Redis connections opened here
 * behave like a boot step: a bad URL fails the cold start, not a user request.
 * Signal handling and graceful shutdown are Vercel's job, not ours.
 *
 * Serverless expects RATE_LIMIT_BACKEND=redis — with `memory`, rate-limit
 * counters and the logout blacklist would be per-lambda and near-useless.
 */

// Must be first: loads .env into process.env before @/config/env validates it.
// On Vercel there is no .env file — dotenv is a no-op and platform env vars win.
import '@/config/bootstrapEnv';
import { createApp } from '@/app';
import { env } from '@/config/env';
import { connectPrisma } from '@/shared/db/prisma';
import { connectMongo } from '@/shared/db/mongoose';
import { connectRedis, useRedisBackend } from '@/shared/cache/redisClient';

if (env.PERSISTENCE === 'database') {
  await connectPrisma();
  await connectMongo(env.MONGODB_URI);
}
if (useRedisBackend()) {
  await connectRedis();
}

export default createApp();
