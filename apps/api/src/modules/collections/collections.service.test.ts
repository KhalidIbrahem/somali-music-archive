import { describe, it, expect, beforeEach } from 'vitest';
import { AppError } from '@/shared/errors/AppError';
import { InMemoryRecordingRepository } from '@/modules/recordings/recordings.repository';
import { InMemoryCollectionRepository } from './collections.repository';
import { createCollectionsService, type CollectionsService } from './collections.service';

const OWNER = 'owner-1';

let repo: InMemoryCollectionRepository;
let recordings: InMemoryRecordingRepository;
let service: CollectionsService;

async function publish(title: string): Promise<string> {
  const draft = await recordings.createDraft({ fileKey: 'k', format: 'wav', sessionId: 's' });
  await recordings.complete(draft.recordingId, {
    title: { somali: title },
    singerName: 'Singer',
    genre: 'qaraami',
    instruments: ['oud'],
  });
  await recordings.updateModeration(draft.recordingId, { status: 'published' });
  return draft.recordingId;
}

beforeEach(() => {
  repo = new InMemoryCollectionRepository();
  recordings = new InMemoryRecordingRepository();
  service = createCollectionsService({ repo, recordings });
});

describe('createCollection / listMine', () => {
  it('creates a collection and lists it with an item count', async () => {
    const created = await service.createCollection(OWNER, {
      name: 'Balwo classics',
      isPublic: false,
    });
    expect(created.name).toBe('Balwo classics');
    expect(created.itemCount).toBe(0);

    const mine = await service.listMine(OWNER);
    expect(mine.total).toBe(1);
    expect(mine.data[0]?.id).toBe(created.id);
  });
});

describe('addItem / getCollection', () => {
  it('adds a published recording and hydrates it in the detail view', async () => {
    const rec = await publish('Hobalka');
    const col = await service.createCollection(OWNER, { name: 'C', isPublic: false });

    const updated = await service.addItem(OWNER, col.id, { recordingId: rec });
    expect(updated.itemCount).toBe(1);

    const detail = await service.getCollection(col.id, OWNER);
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]?.title.somali).toBe('Hobalka');
  });

  it('is idempotent and rejects unpublished/unknown recordings', async () => {
    const rec = await publish('X');
    const col = await service.createCollection(OWNER, { name: 'C', isPublic: false });
    await service.addItem(OWNER, col.id, { recordingId: rec });
    await service.addItem(OWNER, col.id, { recordingId: rec }); // duplicate
    expect((await service.getCollection(col.id, OWNER)).itemCount).toBe(1);

    await expect(
      service.addItem(OWNER, col.id, { recordingId: 'f'.repeat(24) }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('forbids a non-owner from adding items', async () => {
    const rec = await publish('X');
    const col = await service.createCollection(OWNER, { name: 'C', isPublic: false });
    await expect(service.addItem('intruder', col.id, { recordingId: rec })).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it('drops items whose recording is no longer published', async () => {
    const rec = await publish('Pulled');
    const col = await service.createCollection(OWNER, { name: 'C', isPublic: false });
    await service.addItem(OWNER, col.id, { recordingId: rec });
    await recordings.updateModeration(rec, { status: 'archived' });

    const detail = await service.getCollection(col.id, OWNER);
    expect(detail.itemCount).toBe(1); // still stored
    expect(detail.items).toHaveLength(0); // but not surfaced
  });
});

describe('visibility', () => {
  it('lets others read a public collection but not a private one', async () => {
    const priv = await service.createCollection(OWNER, { name: 'Private', isPublic: false });
    const pub = await service.createCollection(OWNER, { name: 'Public', isPublic: true });

    await expect(service.getCollection(priv.id, 'stranger')).rejects.toBeInstanceOf(AppError);
    await expect(service.getCollection(pub.id, 'stranger')).resolves.toBeDefined();
  });
});

describe('removeItem / deleteCollection', () => {
  it('removes an item and deletes the collection (owner only)', async () => {
    const rec = await publish('X');
    const col = await service.createCollection(OWNER, { name: 'C', isPublic: false });
    await service.addItem(OWNER, col.id, { recordingId: rec });

    await service.removeItem(OWNER, col.id, rec);
    expect((await service.getCollection(col.id, OWNER)).itemCount).toBe(0);

    await expect(service.deleteCollection('intruder', col.id)).rejects.toBeInstanceOf(AppError);
    await service.deleteCollection(OWNER, col.id);
    await expect(service.getCollection(col.id, OWNER)).rejects.toBeInstanceOf(AppError);
  });
});
