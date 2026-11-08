/**
 * Qaamuus — the Somali music glossary ("reverse dictionary") shared by the
 * studio's Learn panel and the public reference dataset
 * (apps/ai-service/scripts/build_hf_dataset.py reads lib/learn/glossary.json).
 *
 * Every entry is a term in standard Somali orthography with an English gloss,
 * a definition, search tags (so a description in either language finds the
 * term), its sources and an honesty flag: `attested` = found in a cited
 * scholarly or primary source, `reported` = widely used and documented in
 * secondary sources, `uncertain` = heard/used but not yet verified here.
 */

import type { PentatonicMode } from '@/lib/daw/types';

export type GlossaryCategory =
  | 'genre'
  | 'form'
  | 'poetry'
  | 'dance'
  | 'ritual'
  | 'instrument'
  | 'performance'
  | 'theory'
  | 'rhythm'
  | 'people'
  | 'institution'
  | 'production';

export const GLOSSARY_CATEGORIES: readonly GlossaryCategory[] = [
  'genre',
  'form',
  'poetry',
  'dance',
  'ritual',
  'instrument',
  'performance',
  'theory',
  'rhythm',
  'people',
  'institution',
  'production',
];

export type GlossaryConfidence = 'attested' | 'reported' | 'uncertain';

/** Something the studio can play for a term: a groove preset, a scale, or a published clip. */
export type GlossaryListen =
  | { kind: 'groove'; presetId: string }
  | { kind: 'scale'; mode: PentatonicMode; root?: number }
  | { kind: 'clip'; url: string };

export interface GlossaryEntry {
  /** Kebab-case slug of the Somali term, stable across versions ("qaraami"). */
  id: string;
  /** The term in standard Somali Latin orthography. */
  term: string;
  /** Other spellings, plural/definite forms, older or regional variants. */
  variants: string[];
  /** Short English gloss, one to six words. */
  english: string;
  category: GlossaryCategory;
  /** English definition, one to three sentences; says only what the sources support. */
  definition: string;
  /** Somali definition when available. */
  definitionSo?: string;
  /** Etymology, with "attested"/"disputed" stated in the text itself. */
  etymology?: string;
  /** Ids of related entries. */
  related: string[];
  /** English (and Somali) words a user might type when looking for this term. */
  tags: string[];
  /** Citations: "Author (year), Title" or a URL. Empty only for `uncertain`. */
  sources: string[];
  confidence: GlossaryConfidence;
  listen?: GlossaryListen;
}

export interface GlossaryFile {
  version: number;
  updated: string;
  license: string;
  entries: GlossaryEntry[];
}
