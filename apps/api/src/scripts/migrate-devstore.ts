/**
 * Migrate the dev store into the live databases (SESSION P5-02, final step).
 *
 *   PERSISTENCE=database npm run migrate:devstore              copy users + recordings
 *   PERSISTENCE=database npm run migrate:devstore -- --dry-run  report only, write nothing
 *
 * Copies `.data/dev-store.json` into the real backends through the same repository
 * classes the server uses: users → Prisma/Postgres, recordings → Mongoose/Mongo.
 * Idempotent — users are matched by email and recordings by fileKey; existing rows
 * are skipped, so partial runs and re-runs are safe.
 *
 * Password hashes are copied verbatim, so migrated accounts keep the shared seed
 * password printed by `npm run seed`. Rotate those passwords before any public
 * deploy — P5-01 owns this.
 */

import '@/config/bootstrapEnv'; // load .env — deliberately NOT @/config/env (it throws)
import { recordingCompleteMetadataSchema, type RecordingCompleteMetadata } from '@sma/validators';
import type { RecordingDoc } from '@/modules/recordings/recordings.repository';
import { useDatabase } from '@/shared/db/driver';
import { loadDevStore } from '@/shared/devStore/devStore';

function fail(message: string): never {
  // eslint-disable-next-line no-console
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** Map a stored dev doc back to the metadata shape `complete()` accepts. */
function toCompleteMetadata(doc: RecordingDoc): RecordingCompleteMetadata {
  return recordingCompleteMetadataSchema.parse({
    title: { somali: doc.title.somali },
    singerName: doc.artistName,
    ...(doc.poetName !== undefined ? { poetName: doc.poetName } : {}),
    genre: doc.genre,
    ...(doc.occasion !== undefined ? { occasion: doc.occasion } : {}),
    ...(doc.region !== undefined ? { region: doc.region } : {}),
    ...(doc.era !== undefined ? { era: doc.era } : {}),
    instruments: doc.instruments,
    ...(doc.fieldNotes !== undefined ? { fieldNotes: doc.fieldNotes } : {}),
  });
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  if (!useDatabase()) {
    fail(
      'This script writes to the live databases. Run it as:\n' +
        '    PERSISTENCE=database npm run migrate:devstore',
    );
  }
  const store = loadDevStore();
  if (!store) fail('No dev store found. Run `npm run seed` first.');

  const mongoUri = process.env['MONGODB_URI'];
  if (!process.env['POSTGRES_URL']) fail('POSTGRES_URL is not set.');
  if (!mongoUri) fail('MONGODB_URI is not set.');

  // Import the db layer only after the guards, so the failure paths above never
  // touch Prisma/Mongoose (same pattern as ingest-harvard).
  const { getPrisma, disconnectPrisma } = await import('@/shared/db/prisma');
  const { connectMongo, disconnectMongo } = await import('@/shared/db/mongoose');
  const { PrismaUserRepository } = await import('@/modules/auth/user.prisma.repository');
  const { MongoRecordingRepository } =
    await import('@/modules/recordings/recordings.mongo.repository');
  const { RecordingModel } = await import('@/modules/recordings/recording.model');

  await connectMongo(mongoUri);
  const users = new PrismaUserRepository(getPrisma());
  const recordings = new MongoRecordingRepository();

  // ── Users → Postgres ────────────────────────────────────────────────────────
  let usersCreated = 0;
  let usersSkipped = 0;
  for (const user of store.users) {
    if ((await users.findByEmail(user.email)) !== null) {
      usersSkipped += 1;
      continue;
    }
    if (dryRun) {
      usersCreated += 1;
      continue;
    }
    const created = await users.create({
      email: user.email,
      passwordHash: user.passwordHash,
      displayName: user.displayName,
      language: user.language,
      role: user.role,
    });
    if (user.emailVerified) await users.markEmailVerified(created.id);
    usersCreated += 1;
  }

  // ── Recordings → Mongo ──────────────────────────────────────────────────────
  let recordingsCreated = 0;
  let recordingsSkipped = 0;
  const failures: Array<{ fileKey: string; error: string }> = [];
  for (const doc of store.recordings) {
    try {
      if ((await RecordingModel.exists({ fileKey: doc.fileKey })) !== null) {
        recordingsSkipped += 1;
        continue;
      }
      const metadata = toCompleteMetadata(doc); // validates in dry-run too
      if (dryRun) {
        recordingsCreated += 1;
        continue;
      }
      const { recordingId } = await recordings.createDraft({
        fileKey: doc.fileKey,
        format: doc.format,
        sessionId: doc.sessionId,
      });
      await recordings.complete(recordingId, metadata);
      await recordings.updateModeration(recordingId, {
        status: doc.status,
        visibility: doc.visibility,
      });
      recordingsCreated += 1;
    } catch (error) {
      failures.push({ fileKey: doc.fileKey, error: String(error) });
    }
  }

  await disconnectMongo();
  await disconnectPrisma();

  // ── Report ──────────────────────────────────────────────────────────────────
  const mode = dryRun ? 'DRY RUN — nothing written' : 'written to live databases';
  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      `✓ Dev-store migration complete (${mode}):`,
      `    users     — created: ${usersCreated}, skipped (already exist): ${usersSkipped}`,
      `    recordings — created: ${recordingsCreated}, skipped (already exist): ${recordingsSkipped}`,
      `    failed: ${failures.length}`,
      ...failures.map((f) => `      • ${f.fileKey}: ${f.error}`),
      '',
      '⚠  Migrated accounts keep the shared seed password (printed by `npm run seed`).',
      '   Rotate them before any public deploy (P5-01).',
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('✗ Migration failed:', error);
  process.exit(1);
});
