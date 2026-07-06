/**
 * Production-readiness checks (SESSION "preflight doctor", P5-02 prep).
 *
 * Each check probes one external dependency and reports a structured result —
 * never throwing, never printing secret VALUES (only variable NAMES). The doctor
 * script (scripts/doctor.ts) runs them all and renders the report; the database
 * checks are integration-tested against embedded Postgres/Mongo, so the doctor's
 * verdicts are themselves verified code, not hopeful shell commands.
 *
 * Env-light by design (no import of `@/config/env`, which throws on a broken
 * environment — diagnosing exactly that is the doctor's job).
 */

import net from 'node:net';
import tls from 'node:tls';
import { Prisma, PrismaClient } from '@prisma/client';
import mongoose from 'mongoose';
import { envSchema } from '@/config/envSchema';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

const TIMEOUT_MS = 8_000;

async function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} timed out after ${TIMEOUT_MS}ms`)),
      TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ── Environment ──────────────────────────────────────────────────────────────

/** Validate an env map against the boot schema, reporting variable NAMES only. */
export function checkEnv(env: Record<string, string | undefined>): CheckResult {
  const parsed = envSchema.safeParse(env);
  if (parsed.success) {
    return { name: 'env', status: 'ok', detail: 'all required variables present and well-formed' };
  }
  const names = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))];
  return {
    name: 'env',
    status: 'fail',
    detail: `invalid or missing: ${names.join(', ')}`,
  };
}

// ── PostgreSQL (Prisma) ──────────────────────────────────────────────────────

/** Model probes cover every Prisma-backed repository; P2021 = table missing. */
const MODEL_PROBES: ReadonlyArray<[string, (p: PrismaClient) => Promise<number>]> = [
  ['users', (p) => p.user.count()],
  ['refresh_tokens', (p) => p.refreshToken.count()],
  ['verification_tokens', (p) => p.verificationToken.count()],
  ['subscriptions', (p) => p.subscription.count()],
  ['lesson_progress', (p) => p.lessonProgress.count()],
  ['saved_recordings', (p) => p.savedRecording.count()],
  ['organizations', (p) => p.organization.count()],
  ['collections', (p) => p.collection.count()],
  ['comments', (p) => p.comment.count()],
  ['api_keys', (p) => p.apiKey.count()],
];

export async function checkPostgres(url: string): Promise<CheckResult> {
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    await withTimeout(prisma.$queryRawUnsafe('SELECT 1'), 'postgres connect');

    const missing: string[] = [];
    for (const [table, probe] of MODEL_PROBES) {
      try {
        await probe(prisma);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021') {
          missing.push(table);
        } else {
          throw error;
        }
      }
    }
    if (missing.length > 0) {
      return {
        name: 'postgres',
        status: 'fail',
        detail: `connected, but schema not migrated — missing tables: ${missing.join(', ')} (run prisma migrate/db push)`,
      };
    }

    // pgvector lives outside the Prisma schema (prisma/sql/008_pgvector.sql).
    const ext = await prisma.$queryRawUnsafe<Array<{ extname: string }>>(
      "SELECT extname FROM pg_extension WHERE extname = 'vector'",
    );
    const embeddings = await prisma.$queryRawUnsafe<Array<{ ok: string | null }>>(
      "SELECT to_regclass('public.audio_embeddings')::text AS ok",
    );
    if (ext.length === 0 || !embeddings[0]?.ok) {
      return {
        name: 'postgres',
        status: 'warn',
        detail:
          'connected, all Prisma tables present — but pgvector is not set up (apply prisma/sql/008_pgvector.sql)',
      };
    }
    return { name: 'postgres', status: 'ok', detail: 'connected; schema + pgvector present' };
  } catch (error) {
    return { name: 'postgres', status: 'fail', detail: message(error) };
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

// ── MongoDB (Mongoose) ───────────────────────────────────────────────────────

export async function checkMongo(uri: string): Promise<CheckResult> {
  let conn: mongoose.Connection | undefined;
  try {
    conn = await withTimeout(
      mongoose.createConnection(uri, { bufferCommands: false }).asPromise(),
      'mongo connect',
    );
    const db = conn.db;
    if (!db) throw new Error('connection has no database handle');
    await withTimeout(db.admin().command({ ping: 1 }), 'mongo ping');

    // The archive-feed compound index (P4-07). The server syncs indexes on boot,
    // so absence is a warning (fresh database), not a failure.
    try {
      const indexes = await db.collection('recordings').indexes();
      const hasFeedIndex = indexes.some(
        (ix) => JSON.stringify(ix.key) === JSON.stringify({ status: 1, createdAt: -1 }),
      );
      if (!hasFeedIndex) {
        return {
          name: 'mongo',
          status: 'warn',
          detail: 'connected — feed index {status,createdAt} not present yet (created on API boot)',
        };
      }
    } catch {
      return {
        name: 'mongo',
        status: 'warn',
        detail: 'connected — recordings collection not created yet (created on first write)',
      };
    }
    return { name: 'mongo', status: 'ok', detail: 'connected; recordings feed index present' };
  } catch (error) {
    return { name: 'mongo', status: 'fail', detail: message(error) };
  } finally {
    await conn?.close().catch(() => undefined);
  }
}

// ── Redis (raw RESP ping — no client dependency) ─────────────────────────────

export interface RedisTarget {
  tls: boolean;
  host: string;
  port: number;
  username: string | undefined;
  password: string | undefined;
}

export function parseRedisUrl(url: string): RedisTarget {
  const u = new URL(url);
  if (u.protocol !== 'redis:' && u.protocol !== 'rediss:') {
    throw new Error(`unsupported scheme "${u.protocol}" — expected redis:// or rediss://`);
  }
  return {
    tls: u.protocol === 'rediss:',
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username || undefined,
    password: u.password || undefined,
  };
}

function respCommand(...parts: string[]): string {
  return `*${parts.length}\r\n${parts.map((p) => `$${Buffer.byteLength(p)}\r\n${p}\r\n`).join('')}`;
}

export async function checkRedis(url: string): Promise<CheckResult> {
  let target: RedisTarget;
  try {
    target = parseRedisUrl(url);
  } catch (error) {
    return { name: 'redis', status: 'fail', detail: message(error) };
  }

  return new Promise<CheckResult>((resolve) => {
    const finish = (result: CheckResult): void => {
      socket.destroy();
      resolve(result);
    };
    const onConnect = (): void => {
      if (target.password) {
        socket.write(
          target.username
            ? respCommand('AUTH', target.username, target.password)
            : respCommand('AUTH', target.password),
        );
      }
      socket.write(respCommand('PING'));
    };
    const socket: net.Socket = target.tls
      ? tls.connect({ host: target.host, port: target.port, servername: target.host }, onConnect)
      : net.connect({ host: target.host, port: target.port }, onConnect);
    socket.setTimeout(TIMEOUT_MS, () =>
      finish({ name: 'redis', status: 'fail', detail: `no PONG within ${TIMEOUT_MS}ms` }),
    );
    let buffer = '';
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      if (buffer.includes('+PONG')) {
        finish({ name: 'redis', status: 'ok', detail: `PONG from ${target.host}:${target.port}` });
      } else if (buffer.includes('-ERR') || buffer.includes('-WRONGPASS')) {
        finish({ name: 'redis', status: 'fail', detail: buffer.split('\r\n')[0] ?? 'redis error' });
      }
    });
    socket.on('error', (error) =>
      finish({ name: 'redis', status: 'fail', detail: message(error) }),
    );
  });
}

// ── HTTP health (AI service) ─────────────────────────────────────────────────

export async function checkHttpHealth(name: string, baseUrl: string): Promise<CheckResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok
      ? { name, status: 'ok', detail: `${url} → ${res.status}` }
      : { name, status: 'fail', detail: `${url} → ${res.status}` };
  } catch (error) {
    return { name, status: 'fail', detail: `${url} unreachable: ${message(error)}` };
  }
}

// ── Cloudflare R2 ────────────────────────────────────────────────────────────

export async function checkR2(config: {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}): Promise<CheckResult> {
  try {
    const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    await withTimeout(client.send(new HeadBucketCommand({ Bucket: config.bucket })), 'R2 head');
    return { name: 'r2', status: 'ok', detail: `bucket "${config.bucket}" reachable` };
  } catch (error) {
    return { name: 'r2', status: 'fail', detail: message(error) };
  }
}

// ── Stripe ───────────────────────────────────────────────────────────────────

export async function checkStripe(secretKey: string): Promise<CheckResult> {
  const looksLikeKey = /^sk_(test|live)_/.test(secretKey);
  if (!looksLikeKey) {
    return {
      name: 'stripe',
      status: 'fail',
      detail: 'STRIPE_SECRET_KEY is not an sk_test_/sk_live_ key',
    };
  }
  try {
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(secretKey);
    await withTimeout(stripe.balance.retrieve(), 'stripe auth');
    const mode = secretKey.startsWith('sk_live_') ? 'LIVE mode' : 'test mode';
    return { name: 'stripe', status: 'ok', detail: `key valid (${mode})` };
  } catch (error) {
    return { name: 'stripe', status: 'fail', detail: message(error) };
  }
}

// ── Report ───────────────────────────────────────────────────────────────────

const SYMBOL: Record<CheckStatus, string> = { ok: '✓', warn: '△', fail: '✗', skip: '–' };

export function formatReport(results: readonly CheckResult[]): {
  text: string;
  failures: number;
} {
  const width = Math.max(...results.map((r) => r.name.length));
  const lines = results.map((r) => `  ${SYMBOL[r.status]} ${r.name.padEnd(width)}  ${r.detail}`);
  const failures = results.filter((r) => r.status === 'fail').length;
  const warns = results.filter((r) => r.status === 'warn').length;
  const summary =
    failures === 0
      ? `All checks passed${warns ? ` (${warns} warning${warns > 1 ? 's' : ''})` : ''}.`
      : `${failures} check${failures > 1 ? 's' : ''} FAILED${warns ? `, ${warns} warning${warns > 1 ? 's' : ''}` : ''}.`;
  return { text: [...lines, '', `  ${summary}`].join('\n'), failures };
}
