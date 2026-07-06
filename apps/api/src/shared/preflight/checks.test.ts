/**
 * Preflight check tests. The Postgres/Mongo checks run against the same embedded
 * engines as the repository integration suites, so the doctor's verdicts are
 * verified behavior: it must fail on an unmigrated database, warn on a missing
 * pgvector extension or feed index, and pass when things are actually right.
 */

import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { checkEnv, checkMongo, checkPostgres, formatReport, parseRedisUrl } from './checks';

const VALID_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: 'x'.repeat(40),
  JWT_REFRESH_SECRET: 'y'.repeat(40),
  MONGODB_URI: 'mongodb://localhost/x',
  POSTGRES_URL: 'postgresql://localhost/x',
  REDIS_URL: 'rediss://localhost:6379',
  R2_ACCOUNT_ID: 'a',
  R2_ACCESS_KEY_ID: 'b',
  R2_SECRET_ACCESS_KEY: 'c',
  R2_BUCKET_NAME: 'd',
  R2_PUBLIC_DOMAIN: 'https://cdn.example.com',
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_x',
  STRIPE_PREMIUM_PRICE_ID: 'price_1',
  STRIPE_INSTITUTIONAL_PRICE_ID: 'price_2',
  RESEND_API_KEY: 're_x',
  EMAIL_FROM: 'noreply@example.com',
  AI_SERVICE_URL: 'http://localhost:8000',
  AI_SERVICE_API_KEY: 'k',
};

describe('checkEnv', () => {
  it('passes a complete environment', () => {
    expect(checkEnv(VALID_ENV).status).toBe('ok');
  });

  it('reports variable NAMES (never values) for missing/invalid entries', () => {
    const broken = { ...VALID_ENV, JWT_ACCESS_SECRET: 'short', EMAIL_FROM: undefined };
    const result = checkEnv(broken);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('JWT_ACCESS_SECRET');
    expect(result.detail).toContain('EMAIL_FROM');
    expect(result.detail).not.toContain('short'); // no values in output
  });
});

describe('parseRedisUrl', () => {
  it('parses a full Upstash-style rediss URL', () => {
    expect(parseRedisUrl('rediss://default:tok3n@usw1-x.upstash.io:6379')).toEqual({
      tls: true,
      host: 'usw1-x.upstash.io',
      port: 6379,
      username: 'default',
      password: 'tok3n',
    });
  });

  it('defaults the port and handles no-auth local URLs', () => {
    const target = parseRedisUrl('redis://localhost');
    expect(target).toMatchObject({ tls: false, host: 'localhost', port: 6379 });
  });

  it('rejects non-redis schemes', () => {
    expect(() => parseRedisUrl('https://example.com')).toThrow(/scheme/);
  });
});

describe('checkPostgres (embedded)', () => {
  it('fails on an unmigrated database, then warns for missing pgvector after push', async () => {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const port = 56000 + Math.floor(Math.random() * 1000);
    const url = `postgresql://postgres:pg-test@localhost:${port}/postgres`;
    const pg = new EmbeddedPostgres({
      databaseDir: mkdtempSync(join(tmpdir(), 'sma-doctor-pg-')),
      user: 'postgres',
      password: 'pg-test',
      port,
      persistent: false,
    });
    await pg.initialise();
    await pg.start();
    try {
      // Fresh cluster: connected but no schema → hard failure naming the tables.
      const before = await checkPostgres(url);
      expect(before.status).toBe('fail');
      expect(before.detail).toContain('users');

      execSync('npx prisma db push --skip-generate', {
        cwd: join(__dirname, '../../..'),
        env: { ...process.env, POSTGRES_URL: url },
        stdio: 'pipe',
      });

      // Schema present but pgvector SQL not applied → warn, not fail.
      const after = await checkPostgres(url);
      expect(after.status).toBe('warn');
      expect(after.detail).toContain('pgvector');
    } finally {
      await pg.stop();
    }
  }, 120_000);
});

describe('checkMongo (embedded)', () => {
  it('warns on a fresh database and passes once the feed index exists', async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const server = await MongoMemoryServer.create();
    try {
      const uri = server.getUri();
      const fresh = await checkMongo(uri);
      expect(fresh.status).toBe('warn'); // reachable, no recordings collection yet

      const { default: mongoose } = await import('mongoose');
      const conn = await mongoose.createConnection(uri).asPromise();
      const db = conn.db;
      if (!db) throw new Error('no db handle');
      await db.collection('recordings').createIndex({ status: 1, createdAt: -1 });
      await conn.close();

      const ready = await checkMongo(uri);
      expect(ready.status).toBe('ok');
    } finally {
      await server.stop();
    }
  }, 120_000);

  it('fails cleanly when the server is unreachable', async () => {
    const result = await checkMongo('mongodb://127.0.0.1:59999/nope?serverSelectionTimeoutMS=500');
    expect(result.status).toBe('fail');
  }, 30_000);
});

describe('formatReport', () => {
  it('renders symbols, counts failures, and summarises', () => {
    const { text, failures } = formatReport([
      { name: 'env', status: 'ok', detail: 'fine' },
      { name: 'postgres', status: 'warn', detail: 'pgvector missing' },
      { name: 'stripe', status: 'fail', detail: 'bad key' },
    ]);
    expect(failures).toBe(1);
    expect(text).toContain('✓ env');
    expect(text).toContain('△ postgres');
    expect(text).toContain('✗ stripe');
    expect(text).toContain('1 check FAILED, 1 warning.');
  });
});
