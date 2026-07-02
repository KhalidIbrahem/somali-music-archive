/**
 * Somali traditional music genres.
 *
 * WHY a const-asserted tuple, not a TypeScript `enum`:
 * these string values are persisted verbatim in MongoDB (`recording.genre`) and
 * sent over the wire to every client and the research API. A string-literal union
 * cannot drift from the stored data the way a numeric enum can, and it gives us
 * one shared source of truth for the mobile app, web app, backend, and dataset.
 *
 * RULE FOR THE NEXT 100 YEARS: only ever *append* to this list. Reordering is
 * harmless (values are strings), but removing a value would orphan every
 * recording already tagged with it. Genres are cultural categories — changes are
 * governed by the Cultural Advisory Board (ARCHITECTURE.md §15), not by engineers.
 */

export const GENRES = [
  'heello',
  'qaraami',
  'dhaanto',
  'buraanbur',
  'gabay',
  'jiifto',
  'instrumental',
  'other',
] as const;

export type Genre = (typeof GENRES)[number];

/**
 * Cultural documentation for each genre. Kept in-code (not only in a database)
 * so the meaning of a stored value is always recoverable from the source tree
 * alone — a researcher in 2075 reading an exported dataset can trace every genre
 * label back to this definition without access to any running service.
 */
export interface GenreDescriptor {
  readonly id: Genre;
  /** Display name in English UI. */
  readonly label: string;
  /** One-line cultural description, English. */
  readonly description: string;
}

export const GENRE_DESCRIPTORS: Readonly<Record<Genre, GenreDescriptor>> = {
  heello: {
    id: 'heello',
    label: 'Heello',
    description:
      'Modern Somali sung poetry set to music; the dominant popular form of the 20th-century golden age.',
  },
  qaraami: {
    id: 'qaraami',
    label: 'Qaraami',
    description:
      'Classic mid-century Somali love and art songs, often accompanied by oud (kaban).',
  },
  dhaanto: {
    id: 'dhaanto',
    label: 'Dhaanto',
    description:
      'Rhythmic folk song-and-dance form with roots in the Ogaden pastoralist tradition.',
  },
  buraanbur: {
    id: 'buraanbur',
    label: 'Buraanbur',
    description:
      "Women's poetic and musical form performed at weddings and celebrations, with distinctive metre.",
  },
  gabay: {
    id: 'gabay',
    label: 'Gabay',
    description:
      'Classical Somali alliterative oral poetry — the most prestigious poetic form, often chanted.',
  },
  jiifto: {
    id: 'jiifto',
    label: 'Jiifto',
    description: 'A shorter classical poetic metre, contemplative in character, traditionally chanted.',
  },
  instrumental: {
    id: 'instrumental',
    label: 'Instrumental',
    description: 'Purely instrumental performance with no sung text — e.g. solo oud or kaban pieces.',
  },
  other: {
    id: 'other',
    label: 'Other',
    description:
      'A recording that does not fit an established category; pending review by the Cultural Advisory Board.',
  },
};

/** Convenience map from genre id to display label. */
export const GENRE_LABELS: Readonly<Record<Genre, string>> = Object.fromEntries(
  GENRES.map((g) => [g, GENRE_DESCRIPTORS[g].label]),
) as Record<Genre, string>;

/** Runtime guard — validates untrusted input (e.g. query params) is a known genre. */
export function isGenre(value: unknown): value is Genre {
  return typeof value === 'string' && (GENRES as readonly string[]).includes(value);
}
