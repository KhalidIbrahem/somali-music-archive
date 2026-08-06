/**
 * The listening-room programme — eight of the strongest takes from the local
 * Harvard Loeb Music Library corpus (105 digitised cassette tracks), chosen by
 * estimated SNR and metadata completeness (data/reports/quality +
 * data/harvard_inventory.csv). Each `sourceUrl` points at Harvard's canonical
 * copy; the local MP3s under /public/audio are staging copies only.
 */

export interface ArchiveTrack {
  id: string;
  title: string;
  /** Ensemble / performer credit as catalogued by Harvard. */
  artists: string;
  /** Recording year when the cassette was dated; null for undated tapes. */
  year: number | null;
  durationSec: number;
  /** Somali-flavoured one-line context for the listening room. */
  note: string;
  src: string;
  sourceUrl: string;
}

/** Source + rights line — every corpus row renders this, always (B1-15). */
export const HARVARD_RIGHTS_LINE = 'Source: Harvard Loeb Music Library — rights unverified';

/**
 * The one recording with an engraved transcription today: the sample session.
 * Its audio is synthesized from the pipeline's note list — no archival audio —
 * so it is the archive's own material and the listening room's demonstration
 * of the score binding (detected root A · 106 BPM · beat-tracked).
 */
export const SAMPLE_SESSION_TRACK = {
  id: 'sample-session',
  title: 'Sample session — voice',
  artists: 'Synthesized from the archive’s transcription',
  year: 2026,
  durationSec: 349,
  note: 'The studio’s sample transcription, rendered to sound: 412 notes, pentatonic root A, beat-tracked at 106 BPM.',
  src: '/sample/audio.mp3',
  sourceUrl: '',
} satisfies ArchiveTrack;

export const SAMPLE_RIGHTS_LINE =
  'Synthesized from the archive’s transcription — no archival audio';

export const ARCHIVE_TRACKS: readonly ArchiveTrack[] = [
  {
    id: 'track_0253',
    title: 'Illoow Illoow',
    artists: 'Maxamed Axmed Kuluc and ensemble',
    year: null,
    durationSec: 466,
    note: 'The clearest take in the corpus — a full ensemble in close balance.',
    src: '/audio/track_0253.mp3',
    sourceUrl: 'https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33907408',
  },
  {
    id: 'track_0302',
    title: 'Samsamay',
    artists: 'Qalinle, Sado Ali & Marwo Mohamed',
    year: 1974,
    durationSec: 244,
    note: 'A 1974 session — the tape ends mid-song, as so many of them do.',
    src: '/audio/track_0302.mp3',
    sourceUrl: 'https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42355413',
  },
  {
    id: 'track_0311',
    title: 'Qaahira',
    artists: 'Axmadey Abubakr',
    year: null,
    durationSec: 410,
    note: 'A solo voice carrying the qaraami style across four decades.',
    src: '/audio/track_0311.mp3',
    sourceUrl: 'https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42355444',
  },
  {
    id: 'track_0360',
    title: 'Goormaan ladnaannay',
    artists: 'Heesaha Calanka — Songs for the Flag of Independence',
    year: 1966,
    durationSec: 374,
    note: 'An independence-era flag song, six years after the union of 1960.',
    src: '/audio/track_0360.mp3',
    sourceUrl: 'https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42382757',
  },
  {
    id: 'track_0249',
    title: 'Yaxaas',
    artists: 'Maxamed Axmed Kuluc and ensemble',
    year: 1965,
    durationSec: 422,
    note: 'Recorded July 1965 — among the earliest dated tapes in the corpus.',
    src: '/audio/track_0249.mp3',
    sourceUrl: 'https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33907400',
  },
  {
    id: 'track_0241',
    title: 'In la i talinaayo',
    artists: 'From the play “Allah aammin ma iisho”',
    year: 1966,
    durationSec: 342,
    note: 'Theatre music — Somali plays of the 1960s premiered songs like singles.',
    src: '/audio/track_0241.mp3',
    sourceUrl: 'https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:33944730',
  },
  {
    id: 'track_0300',
    title: 'Tolow yaa nakala guri',
    artists: 'Qalinle, Sado Ali & Marwo Mohamed',
    year: 1973,
    durationSec: 464,
    note: 'A 1973 trio recording, cassette-traded across the Horn and the Gulf.',
    src: '/audio/track_0300.mp3',
    sourceUrl: 'https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42355411',
  },
  {
    id: 'track_0301',
    title: 'Dhidibsaan ku leeyahay',
    artists: 'Qalinle, Sado Ali & Marwo Mohamed',
    year: 1976,
    durationSec: 426,
    note: 'The latest dated take in the set — June 1976, on the eve of the tape boom.',
    src: '/audio/track_0301.mp3',
    sourceUrl: 'https://nrs.lib.harvard.edu/urn-3:fhcl.loeb:42355423',
  },
];
