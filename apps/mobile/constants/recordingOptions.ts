/**
 * Dropdown/chip option lists for the record screen, derived from the shared
 * @sma/constants source of truth so the UI can never offer a value the platform
 * doesn't recognise. Occasion is UI-only (the recording schema treats it as free
 * text), so its list lives here.
 */

import {
  GENRES,
  GENRE_DESCRIPTORS,
  REGIONS,
  REGION_DESCRIPTORS,
  INSTRUMENTS,
  INSTRUMENT_LABELS,
} from '@sma/constants';

export interface Option {
  label: string;
  value: string;
}

export const GENRE_OPTIONS: readonly Option[] = GENRES.map((g) => ({
  label: GENRE_DESCRIPTORS[g].label,
  value: g,
}));

export const REGION_OPTIONS: readonly Option[] = REGIONS.map((r) => ({
  label: REGION_DESCRIPTORS[r].label,
  value: r,
}));

export const INSTRUMENT_OPTIONS: readonly Option[] = INSTRUMENTS.map((i) => ({
  label: INSTRUMENT_LABELS[i],
  value: i,
}));

export const OCCASION_OPTIONS: readonly Option[] = [
  { label: 'Love song', value: 'love song' },
  { label: 'Wedding', value: 'wedding' },
  { label: 'Lullaby', value: 'lullaby' },
  { label: 'National', value: 'national' },
  { label: 'Protest', value: 'protest' },
  { label: 'Religious', value: 'religious' },
  { label: 'Funeral', value: 'funeral' },
];
