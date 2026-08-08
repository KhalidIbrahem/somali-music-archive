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

/**
 * Kaban (oud) sessions — a privately shared qaraami collection (added
 * 2026-08-08). Performer names are deliberately not listed on the site;
 * rights remain with the performers and rights holders. Files live under
 * /public/audio (gitignored like all archival audio; the deploy script
 * re-attaches them).
 */
export const OUD_RIGHTS_LINE =
  'Source: private collection — performers unlisted; rights remain with their holders';

export const OUD_SESSION_TRACKS: readonly ArchiveTrack[] = [
  {
    id: 'oud_kaban_wadada',
    title: 'Kaban wadada',
    artists: 'Kaban (oud) — instrumental',
    year: null,
    durationSec: 370,
    note: 'A solo oud working through the qaraami repertoire, unhurried.',
    src: '/audio/qaraami-kaban-wadada.m4a',
    sourceUrl: '',
  },
  {
    id: 'oud_isku_shuban',
    title: 'Isku shuban — kaban keliya',
    artists: 'Kaban (oud) — instrumental medley',
    year: 2022,
    durationSec: 606,
    note: 'A ten-minute medley on the oud alone — no voice, just the strings.',
    src: '/audio/qaraami-isku-shuban-kaban.mp3',
    sourceUrl: '',
  },
  {
    id: 'oud_awliyo_heelo',
    title: 'Awliyo heelo',
    artists: 'Kaban and voice',
    year: null,
    durationSec: 165,
    note: 'A short heelo in the qaraami manner, oud-led.',
    src: '/audio/qaraami-awliyo-heelo.mp3',
    sourceUrl: '',
  },
  {
    id: 'oud_heeri_maahee',
    title: 'Heeri maahee',
    artists: 'Kaban and voice',
    year: null,
    durationSec: 276,
    note: 'Qaraami song with the oud carrying the line throughout.',
    src: '/audio/qaraami-heeri-maahee.mp3',
    sourceUrl: '',
  },
  {
    id: 'oud_raaxeeye',
    title: 'Raaxeeye hadmooyee',
    artists: 'Kaban and voice',
    year: null,
    durationSec: 369,
    note: 'A patient qaraami performance built on the oud’s pulse.',
    src: '/audio/qaraami-raaxeeye.mp3',
    sourceUrl: '',
  },
  {
    id: 'oud_tagay_luula',
    title: 'Tagay — luula',
    artists: 'Kaban and voice',
    year: null,
    durationSec: 261,
    note: 'Slow qaraami — the oud and the melody leaning on each other.',
    src: '/audio/qaraami-tagay-luula.mp3',
    sourceUrl: '',
  },
  {
    id: 'oud_caruuskayagoow',
    title: 'Caruuskayagoow',
    artists: 'Kaban and voice',
    year: null,
    durationSec: 305,
    note: 'A wedding-song setting in the qaraami style.',
    src: '/audio/qaraami-caruuskayagoow.m4a',
    sourceUrl: '',
  },
  {
    id: 'oud_subcis_balwo',
    title: 'Subcis — balwo',
    artists: 'Kaban and voice',
    year: null,
    durationSec: 555,
    note: 'Balwo verses over the oud — the short love-lyric form qaraami grew from.',
    src: '/audio/qaraami-subcis-balwo.mp3',
    sourceUrl: '',
  },
  {
    id: 'oud_laxanka',
    title: 'Laxanka qaraamiga — riftoon',
    artists: 'Kaban and voice',
    year: null,
    durationSec: 265,
    note: 'A qaraami melody in the riftoon manner.',
    src: '/audio/qaraami-laxanka.mp3',
    sourceUrl: '',
  },
];

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
