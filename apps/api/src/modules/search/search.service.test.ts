import { describe, it, expect, beforeEach } from 'vitest';
import type { RecordingCompleteMetadata } from '@sma/validators';
import type { PublicRecording } from '@sma/types';
import { InMemoryRecordingRepository } from '@/modules/recordings/recordings.repository';
import { InMemorySearchIndex, toSearchDocument } from './searchIndex';
import { createSearchService, type SearchService } from './search.service';

const metadata: RecordingCompleteMetadata = {
  title: { somali: 'Balwo Hobalka' },
  singerName: 'Ahmed Ali Egal',
  genre: 'qaraami',
  instruments: ['oud', 'voice'],
};

let repo: InMemoryRecordingRepository;
let index: InMemorySearchIndex;
let service: SearchService;

/** Create a recording; publish + index it unless `publish` is false. */
async function seed(
  overrides: Partial<RecordingCompleteMetadata>,
  publish = true,
): Promise<PublicRecording> {
  const { recordingId } = await repo.createDraft({ fileKey: 'k', format: 'wav', sessionId: 's' });
  await repo.complete(recordingId, { ...metadata, ...overrides });
  let recording = (await repo.findById(recordingId)) as PublicRecording;
  if (publish) {
    recording = (await repo.updateModeration(recordingId, {
      status: 'published',
    })) as PublicRecording;
  }
  await index.index(toSearchDocument(recording));
  return recording;
}

beforeEach(() => {
  repo = new InMemoryRecordingRepository();
  index = new InMemorySearchIndex();
  service = createSearchService({ index, recordings: repo });
});

describe('search', () => {
  it('hydrates ranked index hits into full published recordings', async () => {
    await seed({ title: { somali: 'Balwo Hobalka' }, singerName: 'Ahmed Ali Egal' });
    await seed({ title: { somali: 'Dhaanto' }, singerName: 'Cumar Dhuule', genre: 'dhaanto' });

    const res = await service.search({ page: 1, limit: 20, q: 'balwo' });
    expect(res.total).toBe(1);
    expect(res.data).toHaveLength(1);
    expect(res.data[0]?.title.somali).toBe('Balwo Hobalka');
    // The hydrated payload is the full recording, not the bare index document.
    expect(res.data[0]?.artist.name).toBe('Ahmed Ali Egal');
  });

  it('combines free text with a genre facet', async () => {
    await seed({ title: { somali: 'Balwo' }, genre: 'qaraami' });
    expect((await service.search({ page: 1, limit: 20, genre: 'qaraami' })).total).toBe(1);
    expect((await service.search({ page: 1, limit: 20, genre: 'dhaanto' })).total).toBe(0);
  });

  it('returns the whole archive for an empty query', async () => {
    await seed({ title: { somali: 'One' } });
    await seed({ title: { somali: 'Two' } });
    expect((await service.search({ page: 1, limit: 20 })).total).toBe(2);
  });

  it('drops a hit whose recording is no longer published', async () => {
    // Indexed while stale, but the source of truth says it is not published: the
    // recording must not leak through the search results.
    const stale = await seed({ title: { somali: 'Pulled Track' } }, false);
    await index.index(toSearchDocument({ ...stale, status: 'published' } as PublicRecording));

    const res = await service.search({ page: 1, limit: 20, q: 'pulled' });
    expect(res.data).toHaveLength(0);
  });
});
