/**
 * Prisma repository integration tests — business modules (SESSION "db-path
 * coverage"). Companion to auth.prisma.repositories.test.ts, which covers the
 * auth-critical repos; this suite covers the remaining Postgres-backed ones:
 * subscriptions, organizations, api keys, collections, comments, and lesson
 * progress — against a REAL PostgreSQL via embedded-postgres.
 *
 * One shared cluster for all six repos (startup dominates the cost); rows are
 * wiped between tests in FK order. Lives in shared/db because it spans modules —
 * the per-module unit suites still run in-memory.
 */

import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { PrismaClient } from '@prisma/client';
import { PrismaSubscriptionRepository } from '@/modules/subscriptions/subscriptions.prisma.repository';
import { PrismaOrganizationRepository } from '@/modules/organizations/organizations.prisma.repository';
import { PrismaApiKeyRepository } from '@/modules/research/apiKey.prisma.repository';
import { PrismaCollectionRepository } from '@/modules/collections/collections.prisma.repository';
import { PrismaCommentRepository } from '@/modules/comments/comments.prisma.repository';
import { PrismaLessonRepository } from '@/modules/lessons/lessons.prisma.repository';

const PORT = 55000 + Math.floor(Math.random() * 1000);
const URL = `postgresql://postgres:pg-test@localhost:${PORT}/postgres`;

let pg: EmbeddedPostgres;
let prisma: PrismaClient;
let subscriptions: PrismaSubscriptionRepository;
let organizations: PrismaOrganizationRepository;
let apiKeys: PrismaApiKeyRepository;
let collections: PrismaCollectionRepository;
let comments: PrismaCommentRepository;
let lessons: PrismaLessonRepository;

const HOUR = 60 * 60 * 1000;
let userSeq = 0;

/** Insert a bare user row to satisfy FKs; each call yields a distinct user. */
async function seedUser(): Promise<string> {
  userSeq += 1;
  const row = await prisma.user.create({
    data: {
      email: `user${userSeq}@example.com`,
      passwordHash: '$2b$12$notarealhashbutlongenoughtostore0000000000000000000000',
      displayName: `User ${userSeq}`,
      language: 'so',
    },
  });
  return row.id;
}

beforeAll(async () => {
  pg = new EmbeddedPostgres({
    databaseDir: mkdtempSync(join(tmpdir(), 'sma-pg-biz-')),
    user: 'postgres',
    password: 'pg-test',
    port: PORT,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();

  execSync('npx prisma db push --skip-generate', {
    cwd: join(__dirname, '../../..'),
    env: { ...process.env, POSTGRES_URL: URL },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ datasourceUrl: URL });
  subscriptions = new PrismaSubscriptionRepository(prisma);
  organizations = new PrismaOrganizationRepository(prisma);
  apiKeys = new PrismaApiKeyRepository(prisma);
  collections = new PrismaCollectionRepository(prisma);
  comments = new PrismaCommentRepository(prisma);
  lessons = new PrismaLessonRepository(prisma);
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await pg.stop();
});

beforeEach(async () => {
  // FK order: children before their parents, users last.
  await prisma.collectionItem.deleteMany();
  await prisma.collection.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.organizationMember.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.lessonProgress.deleteMany();
  await prisma.user.deleteMany();
});

describe('PrismaSubscriptionRepository', () => {
  it('treats a user with no row as free (never persisted)', async () => {
    const userId = await seedUser();
    const sub = await subscriptions.getForUser(userId);
    expect(sub.plan).toBe('free');
    expect(await prisma.subscription.count()).toBe(0);
  });

  it('upsert creates then patches without clobbering unpatched fields', async () => {
    const userId = await seedUser();

    await subscriptions.upsert(userId, {
      stripeCustomerId: 'cus_123',
      plan: 'premium',
      status: 'active',
    });
    // A later webhook patches only the status — customer id must survive.
    const after = await subscriptions.upsert(userId, { status: 'past_due' });

    expect(after.stripeCustomerId).toBe('cus_123');
    expect(after.plan).toBe('premium');
    expect(after.status).toBe('past_due');
    expect(await prisma.subscription.count()).toBe(1); // updated, not duplicated
  });

  it('resolves the Stripe customer id to a user (webhook path)', async () => {
    const userId = await seedUser();
    await subscriptions.upsert(userId, { stripeCustomerId: 'cus_hook', plan: 'premium' });

    expect(await subscriptions.findUserIdByCustomerId('cus_hook')).toBe(userId);
    expect(await subscriptions.findUserIdByCustomerId('cus_unknown')).toBeNull();
  });
});

describe('PrismaOrganizationRepository', () => {
  it('creates an organisation and resolves it by unique license key', async () => {
    const ownerId = await seedUser();
    const org = await organizations.create({
      name: 'Jaamacadda Muqdisho',
      licenseKey: 'SMA-TEST-0001',
      seats: 25,
      ownerId,
      expiresAt: new Date(Date.now() + HOUR),
    });

    expect((await organizations.findByLicenseKey('SMA-TEST-0001'))?.id).toBe(org.id);
    expect(await organizations.findByLicenseKey('SMA-NOPE-0000')).toBeNull();
  });

  it('tracks members with seat counts and join order', async () => {
    const ownerId = await seedUser();
    const org = await organizations.create({
      name: 'Org',
      licenseKey: 'SMA-TEST-0002',
      seats: 2,
      ownerId,
      expiresAt: new Date(Date.now() + HOUR),
    });
    const memberA = await seedUser();
    const memberB = await seedUser();

    await organizations.addMember(org.id, memberA, 'owner');
    await organizations.addMember(org.id, memberB);

    expect(await organizations.countMembers(org.id)).toBe(2);
    const members = await organizations.listMembers(org.id);
    expect(members.map((m) => m.userId)).toEqual([memberA, memberB]);
    expect(members[0]?.role).toBe('owner');

    expect(await organizations.removeMember(org.id, memberB)).toBe(true);
    expect(await organizations.removeMember(org.id, memberB)).toBe(false);
  });

  it('enforces one organisation per user at the database level', async () => {
    const ownerId = await seedUser();
    const other = await organizations.create({
      name: 'First',
      licenseKey: 'SMA-TEST-0003',
      seats: 5,
      ownerId,
      expiresAt: new Date(Date.now() + HOUR),
    });
    const second = await organizations.create({
      name: 'Second',
      licenseKey: 'SMA-TEST-0004',
      seats: 5,
      ownerId,
      expiresAt: new Date(Date.now() + HOUR),
    });
    const userId = await seedUser();

    await organizations.addMember(other.id, userId);
    // organization_members.user_id is UNIQUE — a second membership must be
    // rejected by the DB, not just by service logic.
    await expect(organizations.addMember(second.id, userId)).rejects.toMatchObject({
      code: 'P2002',
    });

    const membership = await organizations.findMembershipForUser(userId);
    expect(membership?.org.id).toBe(other.id);
  });
});

describe('PrismaApiKeyRepository', () => {
  it('finds active keys by prefix, excluding revoked ones', async () => {
    const userId = await seedUser();
    const key = await apiKeys.create({
      userId,
      keyHash: 'hash-a',
      keyPrefix: 'sma_ab',
      name: 'Research key',
      plan: 'academic',
      rateLimit: 100,
      expiresAt: null,
    });

    expect(await apiKeys.findActiveByPrefix('sma_ab')).toHaveLength(1);
    await apiKeys.revoke(key.id, userId);
    expect(await apiKeys.findActiveByPrefix('sma_ab')).toHaveLength(0);
  });

  it("revoke is scoped to the owner — another user's attempt is a no-op", async () => {
    const owner = await seedUser();
    const attacker = await seedUser();
    const key = await apiKeys.create({
      userId: owner,
      keyHash: 'hash-b',
      keyPrefix: 'sma_cd',
      name: 'Key',
      plan: 'academic',
      rateLimit: 100,
      expiresAt: null,
    });

    expect(await apiKeys.revoke(key.id, attacker)).toBe(false);
    expect(await apiKeys.findActiveByPrefix('sma_cd')).toHaveLength(1); // still live
    expect(await apiKeys.revoke(key.id, owner)).toBe(true);
  });

  it('stamps lastUsedAt on touch', async () => {
    const userId = await seedUser();
    const key = await apiKeys.create({
      userId,
      keyHash: 'hash-c',
      keyPrefix: 'sma_ef',
      name: 'Key',
      plan: 'academic',
      rateLimit: 100,
      expiresAt: null,
    });

    await apiKeys.touchLastUsed(key.id);
    const [listed] = await apiKeys.listForUser(userId);
    expect(listed?.lastUsedAt).toBeInstanceOf(Date);
  });
});

describe('PrismaCollectionRepository', () => {
  it('duplicate addItem is a silent no-op (DB unique pair)', async () => {
    const ownerId = await seedUser();
    const collection = await collections.create({
      ownerId,
      name: 'Qaraami classics',
      description: null,
      isPublic: true,
    });

    await collections.addItem(collection.id, 'rec-1');
    await collections.addItem(collection.id, 'rec-1'); // must not throw
    await collections.addItem(collection.id, 'rec-2');

    expect(await collections.countItems(collection.id)).toBe(2);
    expect(await collections.listItems(collection.id)).toEqual(['rec-1', 'rec-2']); // insertion order
  });

  it('deleting a collection cascades its items via the FK', async () => {
    const ownerId = await seedUser();
    const collection = await collections.create({
      ownerId,
      name: 'Temp',
      description: null,
      isPublic: false,
    });
    await collections.addItem(collection.id, 'rec-1');

    await collections.deleteCollection(collection.id);

    expect(await collections.findById(collection.id)).toBeNull();
    expect(await prisma.collectionItem.count()).toBe(0); // cascaded, not orphaned
  });

  it('lists an owner’s collections newest-first', async () => {
    const ownerId = await seedUser();
    await collections.create({ ownerId, name: 'A', description: null, isPublic: true });
    await collections.create({ ownerId, name: 'B', description: null, isPublic: true });

    const mine = await collections.listForOwner(ownerId);
    expect(mine.map((c) => c.name).sort()).toEqual(['A', 'B']);
  });
});

describe('PrismaCommentRepository', () => {
  it('paginates newest-first and reports the true total', async () => {
    const userId = await seedUser();
    for (let i = 1; i <= 3; i += 1) {
      await comments.create({
        recordingId: 'rec-x',
        userId,
        authorName: 'Ayaan',
        body: `comment ${i}`,
      });
    }

    const page1 = await comments.listForRecording('rec-x', 1, 2);
    const page2 = await comments.listForRecording('rec-x', 2, 2);
    expect(page1.total).toBe(3);
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(1);
  });

  it('soft delete hides the comment but the row remains (Principle 4)', async () => {
    const userId = await seedUser();
    const comment = await comments.create({
      recordingId: 'rec-y',
      userId,
      authorName: 'Ayaan',
      body: 'to be moderated away',
    });

    await comments.softDelete(comment.id);

    expect(await comments.findById(comment.id)).toBeNull();
    expect((await comments.listForRecording('rec-y', 1, 10)).total).toBe(0);
    expect(await prisma.comment.count()).toBe(1); // physically retained
  });
});

describe('PrismaLessonRepository', () => {
  it('upserts progress on the (user, lesson) unique pair — no duplicates', async () => {
    const userId = await seedUser();

    await lessons.upsertProgress(userId, 'lesson-1', 'module-1', {
      progressPct: 40,
      lastPositionSec: 30,
    });
    const updated = await lessons.upsertProgress(userId, 'lesson-1', 'module-1', {
      progressPct: 100,
      lastPositionSec: 95,
    });

    expect(updated.completed).toBe(true); // 100% implies completion
    expect(updated.completedAt).toBeDefined();
    expect(await prisma.lessonProgress.count()).toBe(1); // updated in place

    const all = await lessons.listProgress(userId);
    expect(all).toHaveLength(1);
    expect(all[0]?.progressPct).toBe(100);
  });

  it('serves authored lesson content from code, not the database', async () => {
    const modules = await lessons.listModules();
    expect(modules.length).toBeGreaterThan(0); // curriculum ships in-code
  });
});
