/**
 * MongoRecordingRepository integration tests (SESSION "db-path coverage").
 *
 * The unit suite always runs in-memory (NODE_ENV=test), so until now the Mongo
 * repository — including P4-07's findByIds and compound index — had never been
 * executed by any test. This suite runs it against a REAL MongoDB via
 * mongodb-memory-server (in-process mongod, no network, no Atlas), asserting the
 * same repository contract the in-memory implementation honours (ADR-0005).
 *
 * First run downloads the mongod binary (cached under ~/.cache afterwards),
 * hence the generous beforeAll timeout.
 */

import { MongoMemoryServer } from 'mongodb-memory-server';
import type { PitchPoint } from '@sma/types';
import type { RecordingCompleteMetadata } from '@sma/validators';
import { connectMongo, disconnectMongo } from '@/shared/db/mongoose';
import { RecordingModel } from './recording.model';
import { MongoRecordingRepository } from './recordings.mongo.repository';

const metadata: RecordingCompleteMetadata = {
  title: { somali: 'Balwo' },
  singerName: 'Ahmed Ali Egal',
  genre: 'qaraami',
  instruments: ['oud', 'voice'],
};

let server: MongoMemoryServer;
const repo = new MongoRecordingRepository();

/** Create a draft and attach metadata, returning both id forms. */
async function seedRecording(
  overrides: Partial<RecordingCompleteMetadata> = {},
): Promise<{ id: string; humanId: string }> {
  const { recordingId } = await repo.createDraft({
    fileKey: `recordings/test/${Math.random().toString(36).slice(2)}.wav`,
    format: 'wav',
    sessionId: 'itest',
  });
  const completed = await repo.complete(recordingId, { ...metadata, ...overrides });
  if (!completed) throw new Error('seed: complete() returned null');
  return { id: recordingId, humanId: completed.id };
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await connectMongo(server.getUri());
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await server.stop();
});

beforeEach(async () => {
  await RecordingModel.deleteMany({});
});

describe('createDraft / complete / findById', () => {
  it('creates a draft and resolves it by ObjectId AND by human id', async () => {
    const { id, humanId } = await seedRecording();

    const byObjectId = await repo.findById(id);
    const byHumanId = await repo.findById(humanId);

    expect(byObjectId?.title.somali).toBe('Balwo');
    expect(byHumanId?.title.somali).toBe('Balwo');
    expect(String(byObjectId?._id)).toBe(String(byHumanId?._id));
    // complete() moves the recording into moderation, not the public archive.
    expect(byObjectId?.status).toBe('review');
    expect(byObjectId?.ai.status).toBe('processing');
  });

  it('issues per-day, zero-padded human ids in sequence', async () => {
    const first = await seedRecording();
    const second = await seedRecording();

    expect(first.humanId).toMatch(/^\d{4}-\d{2}-\d{2}-\d{3}$/);
    const seq = (h: string): number => Number(h.slice(-3));
    expect(seq(second.humanId)).toBe(seq(first.humanId) + 1);
  });

  it('returns null for an unknown id', async () => {
    expect(await repo.findById('f'.repeat(24))).toBeNull();
    expect(await repo.findById('9999-01-01-001')).toBeNull();
  });
});

describe('findByIds (P4-07 batch hydration)', () => {
  it('fetches a mixed batch of ObjectIds and human ids in one call', async () => {
    const a = await seedRecording({ title: { somali: 'A' } });
    const b = await seedRecording({ title: { somali: 'B' } });

    // One ObjectId, one human id — callers use both forms interchangeably.
    const results = await repo.findByIds([a.id, b.humanId]);

    expect(results).toHaveLength(2);
    expect(new Set(results.map((r) => r.title.somali))).toEqual(new Set(['A', 'B']));
  });

  it('silently skips soft-deleted and unknown ids', async () => {
    const live = await seedRecording({ title: { somali: 'Live' } });
    const dead = await seedRecording({ title: { somali: 'Dead' } });
    await repo.softDelete(dead.id);

    const results = await repo.findByIds([live.id, dead.id, 'f'.repeat(24)]);

    expect(results).toHaveLength(1);
    expect(results[0]?.title.somali).toBe('Live');
  });

  it('returns [] for an empty id list without querying', async () => {
    expect(await repo.findByIds([])).toEqual([]);
  });
});

describe('list / listForModeration', () => {
  it('lists only published recordings, newest coverage across pages', async () => {
    const a = await seedRecording({ title: { somali: 'One' } });
    const b = await seedRecording({ title: { somali: 'Two' } });
    const c = await seedRecording({ title: { somali: 'Three' } });
    await seedRecording({ title: { somali: 'StillInReview' } }); // never published
    for (const r of [a, b, c]) {
      await repo.updateModeration(r.id, { status: 'published', visibility: 'public' });
    }

    const page1 = await repo.list({ page: 1, limit: 2 });
    const page2 = await repo.list({ page: 2, limit: 2 });

    expect(page1.total).toBe(3);
    expect(page1.data).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page2.data).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
    const titles = [...page1.data, ...page2.data].map((r) => r.title.somali);
    expect(new Set(titles)).toEqual(new Set(['One', 'Two', 'Three']));
  });

  it('filters the archive by genre', async () => {
    const q = await seedRecording({ genre: 'qaraami' });
    const d = await seedRecording({ genre: 'dhaanto' });
    for (const r of [q, d]) {
      await repo.updateModeration(r.id, { status: 'published', visibility: 'public' });
    }

    const hits = await repo.list({ page: 1, limit: 10, genre: 'dhaanto' });
    expect(hits.total).toBe(1);
    expect(hits.data[0]?.genre).toBe('dhaanto');
  });

  it('moderation queue sees review items the public list must not', async () => {
    await seedRecording(); // status: review

    const publicList = await repo.list({ page: 1, limit: 10 });
    const queue = await repo.listForModeration({ page: 1, limit: 10, status: 'review' });

    expect(publicList.total).toBe(0);
    expect(queue.total).toBe(1);
    expect(queue.data[0]?.status).toBe('review');
  });
});

describe('updateAi (pipeline stage merging)', () => {
  it('merges independent pipeline stages without clobbering earlier ones', async () => {
    const { id } = await seedRecording();
    const point: PitchPoint = {
      timeSec: 1.5,
      frequencyHz: 440,
      noteLabel: 'la',
      centsDeviation: -12,
    };

    await repo.updateAi(id, { transcriptSomali: 'hobalayow' }); // transcribe stage
    const after = await repo.updateAi(id, { pitchData: [point], voicedFraction: 0.8 }); // pitch stage

    expect(after?.ai.status).toBe('complete');
    expect(after?.ai.transcriptSomali).toBe('hobalayow'); // survived the second $set
    expect(after?.ai.pitchData?.[0]?.frequencyHz).toBe(440);
    expect(after?.ai.voicedFraction).toBe(0.8);
    expect(after?.ai.processedAt).toBeDefined();
  });
});

describe('getFileKey / softDelete', () => {
  it('returns the file key by either id form', async () => {
    const { id, humanId } = await seedRecording();
    const byObjectId = await repo.getFileKey(id);
    expect(byObjectId).toMatch(/^recordings\/test\//);
    expect(await repo.getFileKey(humanId)).toBe(byObjectId);
  });

  it('soft delete hides the recording but NEVER removes the document (hard rule)', async () => {
    const { id } = await seedRecording();

    await repo.softDelete(id);

    expect(await repo.findById(id)).toBeNull();
    expect(await repo.getFileKey(id)).toBeNull();
    // The document must still physically exist, only flagged.
    const raw = await RecordingModel.collection.findOne({});
    expect(raw).not.toBeNull();
    expect(raw?.['deletedAt']).toBeInstanceOf(Date);
  });
});

describe('indexes (P4-07)', () => {
  it('materialises the compound feed index { status: 1, createdAt: -1 }', async () => {
    await RecordingModel.syncIndexes();
    const indexes = await RecordingModel.listIndexes();
    const compound = indexes.find(
      (ix) => JSON.stringify(ix.key) === JSON.stringify({ status: 1, createdAt: -1 }),
    );
    expect(compound).toBeDefined();
  });
});
