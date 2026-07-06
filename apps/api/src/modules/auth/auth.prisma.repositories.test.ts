/**
 * Prisma auth repositories integration tests (SESSION "db-path coverage").
 *
 * Runs the Prisma-backed user / refresh-token / verification-token repositories —
 * the auth-critical persistence path — against a REAL PostgreSQL via
 * embedded-postgres (in-process binaries, no Docker, no live DB). The schema is
 * applied with `prisma db push` at suite start, so what's asserted here includes
 * DB-level guarantees the in-memory doubles cannot exercise: unique constraints,
 * foreign keys, and soft-delete filtering at the SQL layer.
 *
 * All three repos share one embedded cluster (startup is the expensive part);
 * rows are wiped between tests in FK order.
 */

import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaUserRepository } from './user.prisma.repository';
import { PrismaRefreshTokenRepository } from './refreshToken.prisma.repository';
import { PrismaVerificationTokenRepository } from './verificationToken.prisma.repository';

const PORT = 54000 + Math.floor(Math.random() * 1000);
const URL = `postgresql://postgres:pg-test@localhost:${PORT}/postgres`;

let pg: EmbeddedPostgres;
let prisma: PrismaClient;
let users: PrismaUserRepository;
let refreshTokens: PrismaRefreshTokenRepository;
let verificationTokens: PrismaVerificationTokenRepository;

const HOUR = 60 * 60 * 1000;

function newUserInput(email = 'ayaan@example.com') {
  return {
    email,
    passwordHash: '$2b$12$notarealhashbutlongenoughtostore0000000000000000000000',
    displayName: 'Ayaan',
    language: 'so' as const,
  };
}

beforeAll(async () => {
  pg = new EmbeddedPostgres({
    databaseDir: mkdtempSync(join(tmpdir(), 'sma-pg-')),
    user: 'postgres',
    password: 'pg-test',
    port: PORT,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();

  // Apply the canonical Prisma schema to the fresh cluster.
  execSync('npx prisma db push --skip-generate', {
    cwd: join(__dirname, '../../..'),
    env: { ...process.env, POSTGRES_URL: URL },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ datasourceUrl: URL });
  users = new PrismaUserRepository(prisma);
  refreshTokens = new PrismaRefreshTokenRepository(prisma);
  verificationTokens = new PrismaVerificationTokenRepository(prisma);
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await pg.stop();
});

beforeEach(async () => {
  // FK order: children before users.
  await prisma.savedRecording.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.user.deleteMany();
});

describe('PrismaUserRepository', () => {
  it('creates with defaults and finds by email case-insensitively', async () => {
    const created = await users.create(newUserInput());

    expect(created.role).toBe('listener');
    expect(created.emailVerified).toBe(false);
    expect(created.failedLoginAttempts).toBe(0);

    const found = await users.findByEmail('AYAAN@example.com');
    expect(found?.id).toBe(created.id);
  });

  it('enforces email uniqueness at the database level', async () => {
    await users.create(newUserInput());
    await expect(users.create(newUserInput())).rejects.toMatchObject({
      code: 'P2002', // Prisma unique-constraint violation
    });
  });

  it('excludes soft-deleted users from lookups (Principle 4: rows remain)', async () => {
    const created = await users.create(newUserInput());
    await prisma.user.update({ where: { id: created.id }, data: { deletedAt: new Date() } });

    expect(await users.findByEmail(created.email)).toBeNull();
    expect(await users.findById(created.id)).toBeNull();
    // The row itself must still exist.
    expect(await prisma.user.count()).toBe(1);
  });

  it('stamps emailVerifiedAt only on the FIRST verification', async () => {
    const created = await users.create(newUserInput());

    await users.markEmailVerified(created.id);
    const first = await users.findById(created.id);
    await users.markEmailVerified(created.id); // second call must not re-stamp
    const second = await users.findById(created.id);

    expect(first?.emailVerified).toBe(true);
    expect(first?.emailVerifiedAt).not.toBeNull();
    expect(second?.emailVerifiedAt?.getTime()).toBe(first?.emailVerifiedAt?.getTime());
  });

  it('counts failed attempts atomically and resets with the lock', async () => {
    const created = await users.create(newUserInput());

    expect(await users.incrementFailedAttempts(created.id)).toBe(1);
    expect(await users.incrementFailedAttempts(created.id)).toBe(2);
    await users.lockUntil(created.id, new Date(Date.now() + HOUR));

    await users.resetFailedAttempts(created.id);
    const after = await users.findById(created.id);
    expect(after?.failedLoginAttempts).toBe(0);
    expect(after?.lockedUntil).toBeNull();
  });

  it('returns 0 (no throw) when incrementing an unknown user', async () => {
    expect(await users.incrementFailedAttempts('00000000-0000-4000-8000-000000000000')).toBe(0);
  });

  it('saved recordings: upsert is idempotent, listed newest-first', async () => {
    const created = await users.create(newUserInput());

    await users.addSaved(created.id, 'rec-a');
    await users.addSaved(created.id, 'rec-a'); // duplicate save is a no-op
    await users.addSaved(created.id, 'rec-b');

    expect(await users.listSaved(created.id)).toHaveLength(2);
    await users.removeSaved(created.id, 'rec-a');
    expect(await users.listSaved(created.id)).toEqual(['rec-b']);
  });
});

describe('PrismaRefreshTokenRepository', () => {
  it('round-trips an active token and hides revoked/expired ones', async () => {
    const user = await users.create(newUserInput());
    const live = await refreshTokens.create(user.id, 'hash-live', new Date(Date.now() + HOUR));
    await refreshTokens.create(user.id, 'hash-expired', new Date(Date.now() - HOUR));

    expect(await refreshTokens.findActive(user.id, 'hash-live')).not.toBeNull();
    expect(await refreshTokens.findActive(user.id, 'hash-expired')).toBeNull();

    await refreshTokens.revoke(live.id);
    expect(await refreshTokens.findActive(user.id, 'hash-live')).toBeNull();
  });

  it('revokeAllForUser kills every active session (logout-everywhere)', async () => {
    const user = await users.create(newUserInput());
    await refreshTokens.create(user.id, 'hash-1', new Date(Date.now() + HOUR));
    await refreshTokens.create(user.id, 'hash-2', new Date(Date.now() + HOUR));

    await refreshTokens.revokeAllForUser(user.id);

    expect(await refreshTokens.findActive(user.id, 'hash-1')).toBeNull();
    expect(await refreshTokens.findActive(user.id, 'hash-2')).toBeNull();
  });

  it('rejects tokens for a non-existent user (FK integrity)', async () => {
    await expect(
      refreshTokens.create(
        '00000000-0000-4000-8000-000000000000',
        'hash-orphan',
        new Date(Date.now() + HOUR),
      ),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});

describe('PrismaVerificationTokenRepository', () => {
  it('finds a valid token only under its own purpose', async () => {
    const user = await users.create(newUserInput());
    await verificationTokens.create(user.id, 'hash-v', 'email_verify', new Date(Date.now() + HOUR));

    expect(await verificationTokens.findValid('hash-v', 'email_verify')).not.toBeNull();
    expect(await verificationTokens.findValid('hash-v', 'password_reset')).toBeNull();
  });

  it('is single-use: consumed tokens are never valid again', async () => {
    const user = await users.create(newUserInput());
    const token = await verificationTokens.create(
      user.id,
      'hash-once',
      'password_reset',
      new Date(Date.now() + HOUR),
    );

    await verificationTokens.consume(token.id);
    expect(await verificationTokens.findValid('hash-once', 'password_reset')).toBeNull();
    await verificationTokens.consume(token.id); // idempotent, no throw
  });

  it('never returns expired tokens', async () => {
    const user = await users.create(newUserInput());
    await verificationTokens.create(
      user.id,
      'hash-old',
      'email_verify',
      new Date(Date.now() - HOUR),
    );
    expect(await verificationTokens.findValid('hash-old', 'email_verify')).toBeNull();
  });
});
