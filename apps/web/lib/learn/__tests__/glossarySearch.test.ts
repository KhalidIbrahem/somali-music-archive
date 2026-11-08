import { describe, expect, it } from 'vitest';
import glossary from '../glossary.json';
import type { GlossaryEntry, GlossaryFile } from '../glossaryTypes';
import {
  browse,
  buildIndex,
  editDistance,
  normalize,
  relatedEntries,
  searchGlossary,
  suggestTerms,
  tokenMatch,
} from '../glossarySearch';

const file = glossary as GlossaryFile;
const entries: GlossaryEntry[] = file.entries;
const index = buildIndex(entries);
const top = (q: string): string | undefined => searchGlossary(index, q)[0]?.entry.id;

describe('glossary data', () => {
  it('has unique ids, resolvable related links and sources for every non-uncertain entry', () => {
    const ids = new Set(entries.map((e) => e.id));
    expect(ids.size).toBe(entries.length);
    for (const e of entries) {
      for (const r of e.related) expect(ids.has(r)).toBe(true);
      if (e.confidence !== 'uncertain') expect(e.sources.length).toBeGreaterThan(0);
      expect(e.tags.length).toBeGreaterThan(0);
    }
  });
});

describe('normalize / tokenMatch', () => {
  it('strips accents and case', () => {
    expect(normalize('Qaraamí  ÉCOLE')).toBe('qaraami ecole');
  });
  it('scores exact > prefix > typo > substring', () => {
    expect(tokenMatch('kaban', 'kaban')).toBe(1);
    expect(tokenMatch('kab', 'kaban')).toBe(0.75);
    expect(tokenMatch('kabaan', 'kaban')).toBe(0.55);
    expect(tokenMatch('aani', 'kabaani')).toBe(0.35);
    expect(tokenMatch('zz', 'kaban')).toBe(0);
  });
  it('edit distance with early exit', () => {
    expect(editDistance('durbaan', 'durbaan')).toBe(0);
    expect(editDistance('durbaan', 'durban', 2)).toBe(1);
    expect(editDistance('abc', 'xyz', 1)).toBeGreaterThan(1);
  });
});

describe('reverse lookup', () => {
  it('finds the Somali term from an English description', () => {
    expect(top('lute')).toBe('kaban');
    expect(top('oud')).toBe('kaban');
    expect(top('drum')).toBe('durbaan');
    expect(top('lullaby')).toBe('hobeey');
    expect(top("women's wedding poetry")).toBe('buraanbur');
    expect(top('father of somali music')).toBe('cabdullaahi-qarshe');
    expect(top('alliteration')).toBe('higgaad');
    expect(top('cassette tape')).toBe('cajalad');
  });
  it('finds entries from Somali words, with a typo, and from a variant spelling', () => {
    expect(top('heesaa')).toBe('heesaa');
    expect(top('kabaan')).toBe('kaban');
    expect(top('Radio Hargeisa')).toBe('idaacadda-hargeysa');
  });
  it('returns nothing for an empty or stop-word-only query', () => {
    expect(searchGlossary(index, '')).toEqual([]);
    expect(searchGlossary(index, '   ')).toEqual([]);
  });
  it('respects the category filter and the limit', () => {
    const hits = searchGlossary(index, 'song', { category: 'form', limit: 3 });
    expect(hits.length).toBeLessThanOrEqual(3);
    for (const h of hits) expect(h.entry.category).toBe('form');
  });
  it('reports which fields matched, best first', () => {
    const hit = searchGlossary(index, 'kaban')[0];
    expect(hit?.matchedFields[0]).toBe('term');
  });
});

describe('glossary v3: the terms added from the musicology review', () => {
  it('finds the new terms by what they mean', () => {
    expect(top('wooden camel bell')).toBe('koor');
    expect(top('camel watering song')).toBe('hees-geel');
    expect(top('ululation')).toBe('alalaas');
    expect(top('double clarinet')).toBe('zumari');
    expect(top('iron clappers')).toBe('sharaq');
  });

  it('finds a term from its field spelling', () => {
    expect(top('digri')).toBe('dhikri');
    expect(top('hurbo')).toBe('hirwo');
    expect(top('moqoddon')).toBe('mokhoddon');
  });

  it('keeps the possession rites in their own category and out of saar spellings', () => {
    const ritual = browse(entries, 'ritual').map((e) => e.id);
    for (const id of ['saar', 'dhikri', 'mingis', 'nuumbi', 'xayaad', 'sittaat']) {
      expect(ritual).toContain(id);
    }
    const saar = entries.find((e) => e.id === 'saar');
    expect(saar?.variants).not.toContain('mingis');
    expect(top('mingis')).toBe('mingis');
  });

  it('keeps the two senses of haan apart', () => {
    const haan = entries.filter((e) => e.term === 'haan');
    expect(haan.map((e) => e.category).sort()).toEqual(['dance', 'instrument']);
  });
});

describe('browse / related / suggest', () => {
  it('browses alphabetically within a category', () => {
    const instruments = browse(entries, 'instrument');
    expect(instruments.length).toBeGreaterThan(3);
    const names = instruments.map((e) => e.term);
    expect([...names].sort((a, b) => a.localeCompare(b, 'so'))).toEqual(names);
  });
  it('resolves related entries and drops dangling ids', () => {
    const kaban = entries.find((e) => e.id === 'kaban');
    expect(kaban).toBeDefined();
    if (!kaban) return;
    const related = relatedEntries(kaban, entries);
    expect(related.map((e) => e.id)).toContain('qaraami');
    expect(relatedEntries({ ...kaban, related: ['nope'] }, entries)).toEqual([]);
  });
  it('suggests terms by prefix of term, variant or gloss', () => {
    expect(suggestTerms(entries, 'bur').map((e) => e.id)).toContain('buraanbur');
    expect(suggestTerms(entries, 'lull').map((e) => e.id)).toContain('hobeey');
    expect(suggestTerms(entries, 'x')).toEqual([]);
  });
});
