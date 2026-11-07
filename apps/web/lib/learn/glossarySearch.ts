/**
 * Qaamuus search — the "reverse dictionary" over lib/learn/glossary.json.
 *
 * A reverse dictionary is looked up by meaning: the user types what they
 * know ("the lute", "women's wedding poetry", "father of Somali music",
 * "heesaa") and gets the Somali term. So every field of an entry is indexed,
 * with weights that favour the term and its variants, then the English gloss
 * and search tags, then the definitions. Matching is accent-insensitive and
 * tolerant of one typo in longer words; multi-word queries score each word
 * and reward entries that match all of them. Pure functions, no DOM.
 */

import type { GlossaryCategory, GlossaryEntry } from './glossaryTypes';

/** Field weights: a hit on the term itself outranks a hit buried in a definition. */
const WEIGHTS = {
  term: 10,
  variants: 8,
  english: 6,
  tags: 5,
  id: 4,
  related: 1,
  definition: 2,
  definitionSo: 2,
  etymology: 1,
  category: 1,
} as const;

type Field = keyof typeof WEIGHTS;

export interface SearchHit {
  entry: GlossaryEntry;
  /** Relevance, higher is better; comparable only within one query. */
  score: number;
  /** Fields that contributed, best first — the UI can say "matched: tags". */
  matchedFields: Field[];
}

/** Lower-case, strip diacritics, keep letters/digits/apostrophes as word characters. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`´]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  return normalize(text).split(/\s+/).filter(Boolean);
}

/** Words too common to carry meaning in a query. */
const STOP = new Set([
  'the',
  'a',
  'an',
  'of',
  'and',
  'or',
  'in',
  'on',
  'to',
  'for',
  'with',
  'is',
  'are',
  'what',
  'which',
  'who',
  'that',
  'this',
  'somali',
  'music',
  'iyo',
  'ee',
  'oo',
  'ah',
  'waa',
  'la',
  'ku',
  'ka',
]);

/** Damerau-free Levenshtein distance, early exit above `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  const cur: number[] = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      cur[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j] ?? 0;
  }
  return prev[b.length] ?? max + 1;
}

/**
 * How well one query token matches one indexed token: 1 exact, 0.75 prefix
 * (query ≥ 3 letters), 0.55 one edit away (both ≥ 5 letters), 0.35 when the
 * query is contained inside a longer word, else 0.
 */
export function tokenMatch(query: string, word: string): number {
  if (query === word) return 1;
  if (query.length >= 3 && word.startsWith(query)) return 0.75;
  if (query.length >= 5 && word.length >= 5 && editDistance(query, word, 1) <= 1) return 0.55;
  if (query.length >= 4 && word.includes(query)) return 0.35;
  return 0;
}

interface IndexedEntry {
  entry: GlossaryEntry;
  fields: Record<Field, string[]>;
  /** Whole normalized text per field, for phrase matches. */
  text: Record<Field, string>;
  /** Whole names the entry answers to: term, each variant, the gloss and its head. */
  names: string[];
}

/** "oud (short-necked lute)" → "oud"; "modern song form, 1940s" → "modern song form". */
function glossHead(gloss: string): string {
  return normalize(gloss.split(/[(,;:—–]/)[0] ?? gloss);
}

function fieldText(entry: GlossaryEntry, field: Field): string {
  switch (field) {
    case 'term':
      return entry.term;
    case 'variants':
      return entry.variants.join(' ');
    case 'english':
      return entry.english;
    case 'tags':
      return entry.tags.join(' ');
    case 'id':
      return entry.id.replace(/-/g, ' ');
    case 'related':
      return entry.related.join(' ').replace(/-/g, ' ');
    case 'definition':
      return entry.definition;
    case 'definitionSo':
      return entry.definitionSo ?? '';
    case 'etymology':
      return entry.etymology ?? '';
    case 'category':
      return entry.category;
  }
}

const FIELDS = Object.keys(WEIGHTS) as Field[];

export function buildIndex(entries: readonly GlossaryEntry[]): IndexedEntry[] {
  return entries.map((entry) => {
    const fields = {} as Record<Field, string[]>;
    const text = {} as Record<Field, string>;
    for (const field of FIELDS) {
      const raw = fieldText(entry, field);
      text[field] = normalize(raw);
      fields[field] = [...new Set(tokenize(raw))];
    }
    const names = [
      normalize(entry.term),
      ...entry.variants.map(normalize),
      normalize(entry.english),
      glossHead(entry.english),
      normalize(entry.id.replace(/-/g, ' ')),
    ].filter(Boolean);
    return { entry, fields, text, names };
  });
}

export interface SearchOptions {
  limit?: number;
  category?: GlossaryCategory | 'all';
}

/**
 * Rank entries for a free-text query in either language. Returns an empty
 * list for an empty query; `browse()` is the no-query listing.
 */
export function searchGlossary(
  index: readonly IndexedEntry[],
  query: string,
  options: SearchOptions = {},
): SearchHit[] {
  const limit = options.limit ?? 20;
  const category = options.category ?? 'all';
  const normalizedQuery = normalize(query);
  const allTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const tokens = allTokens.filter((t) => !STOP.has(t));
  const queryTokens = tokens.length > 0 ? tokens : allTokens;
  if (queryTokens.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const item of index) {
    if (category !== 'all' && item.entry.category !== category) continue;
    let score = 0;
    let tokensMatched = 0;
    const fieldScores = new Map<Field, number>();
    for (const token of queryTokens) {
      // The best field decides; the others add a little breadth, so an entry
      // that merely repeats a word in every field cannot outrank the entry
      // that IS that word.
      let bestForToken = 0;
      let sumForToken = 0;
      for (const field of FIELDS) {
        let best = 0;
        for (const word of item.fields[field]) {
          const m = tokenMatch(token, word);
          if (m > best) best = m;
          if (best === 1) break;
        }
        if (best > 0) {
          const contribution = best * WEIGHTS[field];
          fieldScores.set(field, (fieldScores.get(field) ?? 0) + contribution);
          if (contribution > bestForToken) bestForToken = contribution;
          sumForToken += contribution;
        }
      }
      if (bestForToken > 0) {
        tokensMatched += 1;
        score += bestForToken + 0.3 * (sumForToken - bestForToken);
      }
    }
    if (tokensMatched === 0) continue;
    // Every query word found somewhere: a strong sign it is the entry meant.
    if (tokensMatched === queryTokens.length && queryTokens.length > 1) score *= 1.4;
    // The query IS one of the entry's names ("oud" is a variant of kaban): decisive.
    if (item.names.includes(normalizedQuery)) {
      score += 14;
      fieldScores.set('term', (fieldScores.get('term') ?? 0) + 14);
    } else if (item.names.some((n) => n.startsWith(`${normalizedQuery} `))) {
      score += 6;
    }
    // The whole query as a phrase inside the term, gloss or tags: decisive.
    if (queryTokens.length > 1) {
      for (const field of ['term', 'variants', 'english', 'tags'] as const) {
        if (item.text[field].includes(normalizedQuery)) {
          score += WEIGHTS[field] * 2;
          fieldScores.set(field, (fieldScores.get(field) ?? 0) + WEIGHTS[field] * 2);
        }
      }
    }
    const matchedFields = [...fieldScores.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
    hits.push({ entry: item.entry, score, matchedFields });
  }
  hits.sort((a, b) => b.score - a.score || a.entry.term.localeCompare(b.entry.term));
  return hits.slice(0, limit);
}

/** Alphabetical listing, optionally one category — what the panel shows before typing. */
export function browse(
  entries: readonly GlossaryEntry[],
  category: GlossaryCategory | 'all' = 'all',
): GlossaryEntry[] {
  return entries
    .filter((e) => category === 'all' || e.category === category)
    .sort((a, b) => a.term.localeCompare(b.term, 'so'));
}

/** Entries an entry points at (dangling ids are skipped). */
export function relatedEntries(
  entry: GlossaryEntry,
  entries: readonly GlossaryEntry[],
): GlossaryEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return entry.related.map((id) => byId.get(id)).filter((e): e is GlossaryEntry => e !== undefined);
}

/** Terms whose spelling or gloss starts with the typed prefix — for autocomplete. */
export function suggestTerms(
  entries: readonly GlossaryEntry[],
  prefix: string,
  limit = 6,
): GlossaryEntry[] {
  const p = normalize(prefix);
  if (p.length < 2) return [];
  const starts = (s: string): boolean =>
    normalize(s)
      .split(/\s+/)
      .some((w) => w.startsWith(p));
  return entries
    .filter((e) => starts(e.term) || e.variants.some(starts) || starts(e.english))
    .sort((a, b) => a.term.localeCompare(b.term))
    .slice(0, limit);
}

export type { IndexedEntry };
