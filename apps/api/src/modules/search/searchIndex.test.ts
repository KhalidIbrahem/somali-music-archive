import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemorySearchIndex,
  tokenize,
  toSearchDocument,
  type SearchDocument,
} from './searchIndex';
import type { SearchQueryInput } from '@sma/validators';
import type { PublicRecording } from '@sma/types';

/** A search query with the pagination defaults the HTTP schema would apply. */
function q(overrides: Partial<SearchQueryInput> = {}): SearchQueryInput {
  return { page: 1, limit: 20, ...overrides } as SearchQueryInput;
}

let index: InMemorySearchIndex;
let seq: number;

function doc(overrides: Partial<SearchDocument>): SearchDocument {
  seq += 1;
  return {
    id: overrides.id ?? `id-${seq}`,
    title: '',
    artistName: '',
    genre: 'qaraami',
    // Distinct, increasing timestamps so recency order is deterministic.
    createdAt: new Date(2026, 0, seq).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  index = new InMemorySearchIndex();
  seq = 0;
});

describe('tokenize', () => {
  it('lowercases and splits on non-word characters', () => {
    expect(tokenize('Balwo — Cusman, 1970s!')).toEqual(['balwo', 'cusman', '1970s']);
  });

  it('keeps Somali Latin letters and drops empties', () => {
    expect(tokenize('  Xamar  iyo   Muqdisho ')).toEqual(['xamar', 'iyo', 'muqdisho']);
  });
});

describe('full-text matching', () => {
  beforeEach(async () => {
    await index.index(doc({ id: 'a', title: 'Balwo Hobalka', artistName: 'Ahmed Ali Egal' }));
    await index.index(doc({ id: 'b', title: 'Dhaanto', artistName: 'Cumar Dhuule' }));
  });

  it('matches a term against the title', async () => {
    const res = await index.search(q({ q: 'balwo' }));
    expect(res.ids).toEqual(['a']);
    expect(res.total).toBe(1);
  });

  it('matches a term against the artist name', async () => {
    expect((await index.search(q({ q: 'ahmed' }))).ids).toEqual(['a']);
    expect((await index.search(q({ q: 'cumar' }))).ids).toEqual(['b']);
  });

  it('returns nothing for a term that appears in no field', async () => {
    expect((await index.search(q({ q: 'nonsense' }))).total).toBe(0);
  });

  it('finds a recording by a word from its transcript', async () => {
    await index.index(doc({ id: 'c', title: 'Untitled', transcriptSomali: 'Hooyo macaan' }));
    expect((await index.search(q({ q: 'macaan' }))).ids).toEqual(['c']);
  });
});

describe('relevance ranking', () => {
  it('ranks a title hit above a transcript-only hit', async () => {
    await index.index(doc({ id: 'transcript', title: 'Something', transcriptSomali: 'geeraar' }));
    await index.index(doc({ id: 'title', title: 'Geeraar' }));

    const res = await index.search(q({ q: 'geeraar' }));
    expect(res.ids).toEqual(['title', 'transcript']);
  });

  it('ranks by term frequency when the field weight is equal', async () => {
    await index.index(doc({ id: 'once', title: 'oud' }));
    await index.index(doc({ id: 'twice', title: 'oud oud' }));

    expect((await index.search(q({ q: 'oud' }))).ids).toEqual(['twice', 'once']);
  });
});

describe('facet filters', () => {
  beforeEach(async () => {
    await index.index(doc({ id: 'q1', genre: 'qaraami', region: 'banaadir', era: '1970s' }));
    await index.index(doc({ id: 'd1', genre: 'dhaanto', region: 'awdal', era: '1980s' }));
  });

  it('filters by genre', async () => {
    expect((await index.search(q({ genre: 'qaraami' }))).ids).toEqual(['q1']);
  });

  it('filters by region and era together', async () => {
    expect((await index.search(q({ region: 'awdal', era: '1980s' }))).ids).toEqual(['d1']);
    expect((await index.search(q({ region: 'awdal', era: '1970s' }))).total).toBe(0);
  });
});

describe('empty query', () => {
  it('returns every document, newest first', async () => {
    await index.index(doc({ id: 'old' })); // createdAt Jan 1
    await index.index(doc({ id: 'new' })); // createdAt Jan 2
    const res = await index.search(q());
    expect(res.ids).toEqual(['new', 'old']);
    expect(res.total).toBe(2);
  });
});

describe('pagination', () => {
  it('slices results and reports hasMore', async () => {
    for (let i = 0; i < 5; i += 1) await index.index(doc({ id: `r${i}`, title: 'oud' }));

    const page1 = await index.search(q({ q: 'oud', page: 1, limit: 2 }));
    expect(page1.ids).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.hasMore).toBe(true);

    const page3 = await index.search(q({ q: 'oud', page: 3, limit: 2 }));
    expect(page3.ids).toHaveLength(1);
    expect(page3.hasMore).toBe(false);
  });
});

describe('index lifecycle', () => {
  it('refreshes a document in place (idempotent by id)', async () => {
    await index.index(doc({ id: 'x', title: 'first' }));
    await index.index(doc({ id: 'x', title: 'second' }));

    expect(await index.count()).toBe(1);
    expect((await index.search(q({ q: 'first' }))).total).toBe(0);
    expect((await index.search(q({ q: 'second' }))).ids).toEqual(['x']);
  });

  it('removes a document', async () => {
    await index.index(doc({ id: 'x', title: 'balwo' }));
    await index.remove('x');
    expect(await index.count()).toBe(0);
    expect((await index.search(q({ q: 'balwo' }))).total).toBe(0);
  });

  it('remove is a no-op for an absent id', async () => {
    await expect(index.remove('missing')).resolves.toBeUndefined();
  });
});

describe('toSearchDocument', () => {
  it('projects titles, artist, poet, and transcript from a recording', () => {
    const recording = {
      _id: 'abc123',
      title: { somali: 'Balwo', english: 'Love Song' },
      artist: { name: 'Ahmed Ali Egal' },
      poet: { name: 'Cabdi' },
      genre: 'qaraami',
      region: 'banaadir',
      era: '1970s',
      occasion: 'aroos',
      ai: { transcriptSomali: 'Hooyo', transcriptEnglish: 'Mother' },
      createdAt: '2026-07-04T00:00:00.000Z',
    } as unknown as PublicRecording;

    expect(toSearchDocument(recording)).toEqual({
      id: 'abc123',
      title: 'Balwo Love Song',
      artistName: 'Ahmed Ali Egal',
      poetName: 'Cabdi',
      genre: 'qaraami',
      region: 'banaadir',
      era: '1970s',
      occasion: 'aroos',
      transcriptSomali: 'Hooyo',
      transcriptEnglish: 'Mother',
      createdAt: '2026-07-04T00:00:00.000Z',
    });
  });

  it('omits absent optional fields', () => {
    const recording = {
      _id: 'x',
      title: { somali: 'Balwo' },
      artist: { name: 'Singer' },
      genre: 'other',
      ai: {},
      createdAt: '2026-07-04T00:00:00.000Z',
    } as unknown as PublicRecording;

    const projected = toSearchDocument(recording);
    expect(projected.title).toBe('Balwo');
    expect(projected).not.toHaveProperty('poetName');
    expect(projected).not.toHaveProperty('region');
    expect(projected).not.toHaveProperty('transcriptSomali');
  });
});
