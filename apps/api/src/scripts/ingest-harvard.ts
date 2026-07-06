/**
 * Ingest the Harvard dataset into the archive (SESSION "harvard ingest", P5-07).
 *
 *   npm run ingest:harvard -- --file path/to/somali_music_dataset_v1.json
 *     [--pitch-dir path/to/pitch_data]   attach per-track pitch analyses
 *     [--include-pitch-points]           embed full pitch frames (large!)
 *     [--publish]                        publish immediately (default: review queue)
 *     [--dry-run]                        validate + report, write nothing
 *
 * Bridges the Colab pipeline (apps/ai-service/notebooks/harvard_pipeline.ipynb)
 * into the platform. Driver-aware like the server: in-memory dev store by default,
 * MongoDB when PERSISTENCE=database (connects itself; env-light otherwise).
 *
 * Governance defaults on purpose: records land in the MODERATION QUEUE ('review'),
 * not the public archive — 605 unreviewed tracks must pass through the same admin
 * gate as any field recording. Audio is NOT uploaded by this script: files go to
 * R2 directly (rclone / S3 CLI) at the keys this script prints — audio never
 * flows through Node.js (CLAUDE.md hard rule).
 *
 * Idempotent: a track whose fileKey already exists is skipped, so partial runs
 * and re-runs are safe.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { loadDevStore, saveDevStore } from '@/shared/devStore/devStore';
import { useDatabase } from '@/shared/db/driver';
import {
  InMemoryRecordingRepository,
  type RecordingRepository,
} from '@/modules/recordings/recordings.repository';
import {
  harvardFileKey,
  harvardPitchFileSchema,
  harvardRecordSchema,
  toAiPatch,
  toCompleteMetadata,
  type HarvardPitchFile,
} from '@/modules/recordings/harvardIngest';

interface Args {
  file: string;
  pitchDir?: string;
  includePitchPoints: boolean;
  publish: boolean;
  dryRun: boolean;
}

function fail(message: string): never {
  // eslint-disable-next-line no-console
  console.error(`✗ ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { file: '', includePitchPoints: false, publish: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file') args.file = argv[++i] ?? '';
    else if (arg === '--pitch-dir') {
      const dir = argv[++i];
      if (dir !== undefined) args.pitchDir = dir;
    } else if (arg === '--include-pitch-points') args.includePitchPoints = true;
    else if (arg === '--publish') args.publish = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else fail(`Unknown argument "${arg}". See the header of this script for usage.`);
  }
  if (!args.file) {
    fail('Usage: npm run ingest:harvard -- --file <somali_music_dataset_v1.json> [options]');
  }
  return args;
}

function loadPitch(args: Args, pitchFileRel: string | null): HarvardPitchFile | undefined {
  if (!args.pitchDir || !pitchFileRel) return undefined;
  // The dataset stores e.g. "pitch_data/track_0042_pitch.json"; take the basename.
  const path = join(args.pitchDir, pitchFileRel.split('/').pop() ?? '');
  if (!existsSync(path)) return undefined;
  return harvardPitchFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.file)) fail(`Dataset file not found: ${args.file}`);
  const raw: unknown = JSON.parse(readFileSync(args.file, 'utf8'));
  const records = z.array(harvardRecordSchema).parse(raw);
  // eslint-disable-next-line no-console
  console.log(`Loaded ${records.length} validated records from ${args.file}`);

  // ── Bind a repository + an existing-fileKey check per driver ───────────────
  let repo: RecordingRepository;
  let hasFileKey: (key: string) => Promise<boolean>;
  let persist: () => void = () => {};
  let disconnect: () => Promise<void> = async () => {};

  if (useDatabase()) {
    const uri = process.env['MONGODB_URI'];
    if (!uri) fail('PERSISTENCE=database but MONGODB_URI is not set.');
    const { connectMongo, disconnectMongo } = await import('@/shared/db/mongoose');
    const { MongoRecordingRepository } =
      await import('@/modules/recordings/recordings.mongo.repository');
    const { RecordingModel } = await import('@/modules/recordings/recording.model');
    await connectMongo(uri);
    repo = new MongoRecordingRepository();
    hasFileKey = async (key) => (await RecordingModel.exists({ fileKey: key })) !== null;
    disconnect = disconnectMongo;
    // eslint-disable-next-line no-console
    console.log('Driver: MongoDB (PERSISTENCE=database)');
  } else {
    const store = loadDevStore();
    if (!store) fail('No dev store found. Run `npm run seed` first.');
    const memory = new InMemoryRecordingRepository();
    memory.hydrate(store.recordings);
    repo = memory;
    hasFileKey = async (key) => memory.snapshot().some((doc) => doc.fileKey === key);
    persist = () => saveDevStore({ users: store.users, recordings: memory.snapshot() });
    // eslint-disable-next-line no-console
    console.log(`Driver: in-memory dev store (${store.recordings.length} existing recordings)`);
  }

  // ── Ingest ──────────────────────────────────────────────────────────────────
  let created = 0;
  let skipped = 0;
  const failures: Array<{ track_id: number; error: string }> = [];

  for (const record of records) {
    const fileKey = harvardFileKey(record.track_id);
    try {
      if (await hasFileKey(fileKey)) {
        skipped += 1;
        continue;
      }
      if (args.dryRun) {
        // Validate the full mapping without writing (round-trip is also unit-tested).
        toCompleteMetadata(record);
        toAiPatch(record, loadPitch(args, record.pitch_data_file), {
          includePitchPoints: args.includePitchPoints,
        });
        created += 1;
        continue;
      }
      const { recordingId } = await repo.createDraft({
        fileKey,
        format: 'wav',
        sessionId: 'harvard-awm',
      });
      await repo.complete(recordingId, toCompleteMetadata(record));
      const patch = toAiPatch(record, loadPitch(args, record.pitch_data_file), {
        includePitchPoints: args.includePitchPoints,
      });
      if (Object.keys(patch).length > 0) {
        await repo.updateAi(recordingId, patch);
      }
      if (args.publish) {
        await repo.updateModeration(recordingId, { status: 'published', visibility: 'public' });
      }
      created += 1;
    } catch (error) {
      failures.push({ track_id: record.track_id, error: String(error) });
    }
  }

  if (!args.dryRun) persist();
  await disconnect();

  // ── Report ──────────────────────────────────────────────────────────────────
  const mode = args.dryRun ? 'DRY RUN — nothing written' : args.publish ? 'published' : 'review';
  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      `✓ Ingest complete (${mode}):`,
      `    created: ${created}`,
      `    skipped (already ingested): ${skipped}`,
      `    failed: ${failures.length}`,
      ...failures.slice(0, 10).map((f) => `      • track ${f.track_id}: ${f.error}`),
      '',
      'NEXT — upload the audio directly to R2 (never through Node, CLAUDE.md):',
      '    rclone copy 03_cleaned_wav/ r2:<bucket>/recordings/harvard/ \\',
      '      --include "track_*.wav"',
      `    (object keys must match ${harvardFileKey(1)} … zero-padded track ids)`,
      args.publish ? '' : '    then publish via the admin dashboard moderation queue (/admin).',
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('✗ Ingest failed:', error);
  process.exit(1);
});
