/**
 * Instruments that appear in Somali traditional music.
 *
 * Referenced by `recording.instruments` (an array — a recording may feature
 * several). 'voice' is included because vocal performance is itself the primary
 * "instrument" of most Somali forms. Append-only, same governance as genres.
 */

export const INSTRUMENTS = [
  'voice', // human voice — the central instrument of sung poetry
  'oud', // the Arabic/Somali lute; the signature melodic instrument
  'kaban', // Somali name for the oud/lute
  'shareero', // traditional Somali lyre
  'durbaan', // drum
  'shambal', // hand percussion / clapping idiophone
  'flute', // reed or wooden flute
  'violin', // adopted into mid-century Somali ensembles
  'accordion', // adopted into mid-century Somali ensembles
  'piano',
  'other',
] as const;

export type Instrument = (typeof INSTRUMENTS)[number];

export const INSTRUMENT_LABELS: Readonly<Record<Instrument, string>> = {
  voice: 'Voice',
  oud: 'Oud',
  kaban: 'Kaban',
  shareero: 'Shareero',
  durbaan: 'Durbaan',
  shambal: 'Shambal',
  flute: 'Flute',
  violin: 'Violin',
  accordion: 'Accordion',
  piano: 'Piano',
  other: 'Other',
};

export function isInstrument(value: unknown): value is Instrument {
  return typeof value === 'string' && (INSTRUMENTS as readonly string[]).includes(value);
}
