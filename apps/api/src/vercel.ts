/**
 * Vercel serverless entry (deploy target: web on Vercel + this API as a single
 * Vercel function; see apps/api/vercel.json).
 *
 * Unlike server.ts this never binds a port — Vercel invokes the exported
 * handler per request. Module scope runs once per lambda instance and is
 * cached across warm invocations, so the connections opened here behave like
 * a boot step. Signal handling and graceful shutdown are Vercel's job.
 *
 * Boot is staged and failure-observable: if any step throws (env validation,
 * Prisma/Mongo/Redis connects, app construction), the export becomes a tiny
 * handler that answers 503 with the failed step and a credential-stripped
 * message — Vercel's own INTERNAL_FUNCTION_INVOCATION_FAILED page names
 * nothing, which makes remote cold-start failures undebuggable from outside.
 *
 * Serverless expects RATE_LIMIT_BACKEND=redis — with `memory`, rate-limit
 * counters and the logout blacklist would be per-lambda and near-useless.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

interface BootFailure {
  step: 'env' | 'prisma' | 'mongo' | 'redis' | 'app';
  name: string;
  message: string;
}

/** Strip userinfo from connection-string fragments before it can reach a log
 *  line or response body. */
function sanitize(message: string): string {
  return message.replace(/\/\/[^@\s/]+@/g, '//***@').slice(0, 300);
}

let bootFailure: BootFailure | null = null;
let handler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;

function fail(step: BootFailure['step'], err: unknown): void {
  const e = err instanceof Error ? err : new Error(String(err));
  bootFailure = { step, name: e.name, message: sanitize(e.message) };
  console.error(`[boot] ${step} failed: ${e.name}: ${sanitize(e.message)}`);
}

try {
  // Must be first: loads .env into process.env before @/config/env validates
  // it. On Vercel there is no .env file — dotenv is a no-op and platform env
  // vars win. Imported dynamically so a validation throw is catchable here.
  await import('@/config/bootstrapEnv');
  const { env } = await import('@/config/env');

  if (env.PERSISTENCE === 'database') {
    try {
      const { connectPrisma } = await import('@/shared/db/prisma');
      await connectPrisma();
    } catch (err) {
      fail('prisma', err);
    }
    if (bootFailure === null) {
      try {
        const { connectMongo } = await import('@/shared/db/mongoose');
        await connectMongo(env.MONGODB_URI);
      } catch (err) {
        fail('mongo', err);
      }
    }
  }
  if (bootFailure === null) {
    try {
      const { connectRedis, useRedisBackend } = await import('@/shared/cache/redisClient');
      if (useRedisBackend()) await connectRedis();
    } catch (err) {
      fail('redis', err);
    }
  }
  if (bootFailure === null) {
    try {
      const { createApp } = await import('@/app');
      handler = createApp() as unknown as (req: IncomingMessage, res: ServerResponse) => void;
    } catch (err) {
      fail('app', err);
    }
  }
} catch (err) {
  fail('env', err);
}

const bootErrorHandler = (_req: IncomingMessage, res: ServerResponse): void => {
  res.statusCode = 503;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(
    JSON.stringify({
      error: 'BOOT_FAILED',
      step: bootFailure?.step ?? 'unknown',
      name: bootFailure?.name ?? 'Error',
      message: bootFailure?.message ?? 'unknown boot failure',
    }),
  );
};

export default handler ?? bootErrorHandler;
