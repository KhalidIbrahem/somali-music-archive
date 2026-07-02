/**
 * Artist — an elder musician or knowledge holder whose work lives in the archive.
 *
 * Mirrors the MongoDB Artist document (ARCHITECTURE.md §9). Artists are treated as
 * co-creators, not "user-generated content": every artist carries an explicit
 * consent record (ARCHITECTURE.md Principle 5 — Dignity of contributors).
 */

import type { Instrument } from '@sma/constants';
import type { ObjectIdString, IsoDateTimeString } from './common';

/** Bilingual free text — Somali original alongside an English rendering. */
export interface BilingualText {
  readonly somali?: string;
  readonly english?: string;
}

export interface Artist {
  readonly id: ObjectIdString;
  readonly name: string;
  readonly nameArabic?: string;
  readonly nameSomali?: string;
  readonly birthYear?: number;
  readonly birthRegion?: string;
  readonly bio?: BilingualText;
  /** e.g. ["Waaberi Band", "Radio Mogadishu"]. */
  readonly affiliations: readonly string[];
  /** e.g. "1965–1991". */
  readonly activePeriod?: string;
  readonly instruments: readonly Instrument[];
  readonly photoUrl?: string;
  /** Cultural consent protocol (ARCHITECTURE.md §15) — must be true to publish. */
  readonly consentOnFile: boolean;
  readonly consentDate?: IsoDateTimeString;
  /** Denormalised counter of published recordings, for list UIs. */
  readonly recordingCount: number;
  readonly createdAt: IsoDateTimeString;
}

/** The subset of Artist safe to expose on a public artist profile screen. */
export type PublicArtist = Omit<Artist, 'consentOnFile' | 'consentDate'>;
