/**
 * Somali cultural regions — where a recording's tradition originates.
 *
 * WHY these are curated cultural regions rather than current administrative
 * borders: political boundaries change; the musical geography of the Somali
 * peoples (the "Greater Somalia" cultural sphere across Somalia, Somaliland,
 * Djibouti, the Somali Region of Ethiopia, and the NFD in Kenya) is more stable
 * and more useful for ethnomusicology. Codes are ISO-3166-2-inspired where a
 * mapping exists, otherwise a stable internal slug. Append-only, same rule as
 * genres: never delete a region that a recording may reference.
 */

export const REGIONS = [
  // ── Somalia (federal member states / historical regions) ──
  'banaadir', // Mogadishu and surrounds — the mid-century recording capital
  'woqooyi-galbeed', // Hargeisa
  'awdal', // Borama
  'togdheer', // Burao
  'sanaag', // Erigavo
  'sool', // Las Anod
  'bari', // Bosaso
  'nugaal', // Garowe
  'mudug', // Galkayo
  'galguduud', // Dhusamareb
  'hiiraan', // Beledweyne
  'middle-shabelle', // Jowhar
  'lower-shabelle', // Merca
  'bay', // Baidoa
  'bakool', // Hudur
  'gedo', // Garbahaarey
  'middle-juba', // Bu'ale
  'lower-juba', // Kismayo
  // ── Greater Somali cultural regions outside the Somalia state ──
  'djibouti', // Republic of Djibouti
  'somali-region-ethiopia', // the Somali Region (historically "Ogaden")
  'nfd-kenya', // North Eastern Kenya (former Northern Frontier District)
  // ── Fallback ──
  'diaspora', // recorded in a diaspora community, origin region unknown/mixed
  'unknown',
] as const;

export type Region = (typeof REGIONS)[number];

export interface RegionDescriptor {
  readonly id: Region;
  /** English display name. */
  readonly label: string;
  /** Representative city/locus, for UI context. */
  readonly locus: string;
}

export const REGION_DESCRIPTORS: Readonly<Record<Region, RegionDescriptor>> = {
  banaadir: { id: 'banaadir', label: 'Banaadir', locus: 'Mogadishu' },
  'woqooyi-galbeed': { id: 'woqooyi-galbeed', label: 'Woqooyi Galbeed', locus: 'Hargeisa' },
  awdal: { id: 'awdal', label: 'Awdal', locus: 'Borama' },
  togdheer: { id: 'togdheer', label: 'Togdheer', locus: 'Burao' },
  sanaag: { id: 'sanaag', label: 'Sanaag', locus: 'Erigavo' },
  sool: { id: 'sool', label: 'Sool', locus: 'Las Anod' },
  bari: { id: 'bari', label: 'Bari', locus: 'Bosaso' },
  nugaal: { id: 'nugaal', label: 'Nugaal', locus: 'Garowe' },
  mudug: { id: 'mudug', label: 'Mudug', locus: 'Galkayo' },
  galguduud: { id: 'galguduud', label: 'Galguduud', locus: 'Dhusamareb' },
  hiiraan: { id: 'hiiraan', label: 'Hiiraan', locus: 'Beledweyne' },
  'middle-shabelle': { id: 'middle-shabelle', label: 'Middle Shabelle', locus: 'Jowhar' },
  'lower-shabelle': { id: 'lower-shabelle', label: 'Lower Shabelle', locus: 'Merca' },
  bay: { id: 'bay', label: 'Bay', locus: 'Baidoa' },
  bakool: { id: 'bakool', label: 'Bakool', locus: 'Hudur' },
  gedo: { id: 'gedo', label: 'Gedo', locus: 'Garbahaarey' },
  'middle-juba': { id: 'middle-juba', label: 'Middle Juba', locus: "Bu'ale" },
  'lower-juba': { id: 'lower-juba', label: 'Lower Juba', locus: 'Kismayo' },
  djibouti: { id: 'djibouti', label: 'Djibouti', locus: 'Djibouti City' },
  'somali-region-ethiopia': {
    id: 'somali-region-ethiopia',
    label: 'Somali Region (Ethiopia)',
    locus: 'Jigjiga',
  },
  'nfd-kenya': { id: 'nfd-kenya', label: 'North Eastern (Kenya)', locus: 'Garissa' },
  diaspora: { id: 'diaspora', label: 'Diaspora', locus: 'Various' },
  unknown: { id: 'unknown', label: 'Unknown', locus: '—' },
};

export const REGION_LABELS: Readonly<Record<Region, string>> = Object.fromEntries(
  REGIONS.map((r) => [r, REGION_DESCRIPTORS[r].label]),
) as Record<Region, string>;

export function isRegion(value: unknown): value is Region {
  return typeof value === 'string' && (REGIONS as readonly string[]).includes(value);
}
