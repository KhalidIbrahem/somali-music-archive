import { describe, it, expect, beforeEach } from 'vitest';
import type { RecordingCompleteMetadata } from '@sma/validators';
import { hashPassword } from '@/modules/auth/password.service';
import { InMemoryRecordingRepository } from '@/modules/recordings/recordings.repository';
import { InMemoryApiKeyRepository } from './apiKey.repository';
import { createResearchService, type ResearchService } from './research.service';

const metadata: RecordingCompleteMetadata = {
  title: { somali: 'Balwo' },
  singerName: 'Ahmed Ali Egal',
  genre: 'qaraami',
  instruments: ['oud', 'voice'],
};

let apiKeys: InMemoryApiKeyRepository;
let recordings: InMemoryRecordingRepository;
let service: ResearchService;
const USER = 'user-1';

beforeEach(() => {
  apiKeys = new InMemoryApiKeyRepository();
  recordings = new InMemoryRecordingRepository();
  service = createResearchService({ apiKeys, recordings });
});

/** Publish a recording, optionally attaching AI pitch analysis. */
async function publish(title: string, withPitch = false): Promise<void> {
  const { recordingId } = await recordings.createDraft({
    fileKey: 'k',
    format: 'wav',
    sessionId: 's',
  });
  await recordings.complete(recordingId, { ...metadata, title: { somali: title } });
  await recordings.updateModeration(recordingId, { status: 'published' });
  if (withPitch) {
    await recordings.updateAi(recordingId, {
      transcriptSomali: 'Hooyo',
      dominantNotes: ['do', 're'],
      voicedFraction: 0.8,
      pitchData: [
        { timeSec: 0, frequencyHz: 293, confidence: 0.9, noteLabel: 'do', centsDeviation: 0 },
      ],
    });
  }
}

describe('createApiKey', () => {
  it('returns a plaintext sma_ key once and stores only a hash', async () => {
    const created = await service.createApiKey(USER, { name: 'My study', plan: 'academic' });

    expect(created.key.startsWith('sma_')).toBe(true);
    expect(created.keyPrefix).toBe(created.key.slice(0, 12));
    expect(created.rateLimit).toBe(1000); // academic default
    expect(created).not.toHaveProperty('keyHash');

    const [stored] = await apiKeys.listForUser(USER);
    expect(stored?.keyHash).toBeDefined();
    expect(stored?.keyHash).not.toBe(created.key); // never plaintext at rest
  });

  it('applies the commercial rate limit', async () => {
    const created = await service.createApiKey(USER, { name: 'Corp', plan: 'commercial' });
    expect(created.rateLimit).toBe(10000);
  });
});

describe('verifyApiKey', () => {
  it('resolves a valid key to its record and rejects a wrong one', async () => {
    const created = await service.createApiKey(USER, { name: 'k', plan: 'academic' });

    const record = await service.verifyApiKey(created.key);
    expect(record?.userId).toBe(USER);
    expect(record?.lastUsedAt).not.toBeNull(); // touched on use

    expect(await service.verifyApiKey('sma_totally-wrong-key-value-000000')).toBeNull();
    expect(await service.verifyApiKey('not-an-sma-key')).toBeNull();
  });

  it('rejects a revoked key', async () => {
    const created = await service.createApiKey(USER, { name: 'k', plan: 'academic' });
    expect(await service.revokeKey(USER, created.id)).toBe(true);
    expect(await service.verifyApiKey(created.key)).toBeNull();
  });

  it('rejects an expired key', async () => {
    const key = 'sma_expiredkeyexpiredkeyexpiredkey00';
    await apiKeys.create({
      userId: USER,
      keyHash: await hashPassword(key),
      keyPrefix: key.slice(0, 12),
      name: 'old',
      plan: 'academic',
      rateLimit: 1000,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await service.verifyApiKey(key)).toBeNull();
  });
});

describe('revokeKey', () => {
  it("will not revoke another user's key", async () => {
    const created = await service.createApiKey(USER, { name: 'k', plan: 'academic' });
    expect(await service.revokeKey('someone-else', created.id)).toBe(false);
  });
});

describe('listKeys', () => {
  it('returns the public shape without the secret or hash', async () => {
    await service.createApiKey(USER, { name: 'k', plan: 'academic' });
    const keys = await service.listKeys(USER);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toHaveProperty('key');
    expect(keys[0]).not.toHaveProperty('keyHash');
  });
});

describe('exportDataset', () => {
  it('exports only published recordings, projected to the research shape', async () => {
    await publish('One');
    await publish('Two');

    const page = await service.exportDataset({ page: 1, limit: 20, includePitch: false });
    expect(page.total).toBe(2);
    expect(page.data[0]?.artist).toBe('Ahmed Ali Egal');
    expect(page.data[0]).toHaveProperty('durationSec');
  });

  it('includes the pitch track only when requested', async () => {
    await publish('WithPitch', true);

    const without = await service.exportDataset({ page: 1, limit: 20, includePitch: false });
    expect(without.data[0]?.ai.pitch).toBeUndefined();
    expect(without.data[0]?.ai.dominantNotes).toEqual(['do', 're']);

    const withPitch = await service.exportDataset({ page: 1, limit: 20, includePitch: true });
    expect(withPitch.data[0]?.ai.pitch).toHaveLength(1);
  });

  it('filters by genre', async () => {
    await publish('One');
    const match = await service.exportDataset({
      page: 1,
      limit: 20,
      includePitch: false,
      genre: 'qaraami',
    });
    expect(match.total).toBe(1);
    const miss = await service.exportDataset({
      page: 1,
      limit: 20,
      includePitch: false,
      genre: 'dhaanto',
    });
    expect(miss.total).toBe(0);
  });
});
