/**
 * Text of the listening study, English and Somali. The Somali is a draft by
 * the assistant, to be checked by Khalid before the link is shared.
 */

import type { BACKGROUNDS, PLAYBACK } from './design';

export type Lang = 'en' | 'so';

export interface StudyText {
  langSwitch: string;
  title: string;
  intro: (trials: number) => string;
  privacy: string;
  consent: string;
  backgroundQ: string;
  backgrounds: Record<(typeof BACKGROUNDS)[number], string>;
  instrument: string;
  years: string;
  familiarity: string;
  familiarityEnds: [string, string];
  playbackQ: string;
  playback: Record<(typeof PLAYBACK)[number], string>;
  start: string;
  resume: string;
  pairOf: (n: number, total: number) => string;
  clip: (side: 'A' | 'B') => string;
  listenFirst: string;
  somaliQ: string;
  somali: { a: string; b: string; same: string; neither: string };
  qualityQ: string;
  quality: { a: string; b: string; same: string };
  next: string;
  finish: string;
  commentQ: string;
  send: string;
  sending: string;
  thanks: string;
  share: string;
  failed: string;
  download: string;
  aiNote: string;
}

export const STRINGS: Record<Lang, StudyText> = {
  en: {
    langSwitch: 'Af-Soomaali',
    title: 'Does it sound Somali?',
    intro: (n) =>
      `QaraamiGen trains AI models on Somali music, and only musicians can judge whether they work. You will hear ${n} pairs of short AI-generated clips (10–20 seconds each). For each pair, choose which sounds more like Somali music, and which sounds better as a recording. It takes about 10 minutes. Headphones help.`,
    privacy:
      'Anonymous: we do not ask for your name or email and do not store your IP address. Your answers are used only for this research and may be published as totals.',
    consent: 'I am 18 or older and agree to take part.',
    backgroundQ: 'How do you know Somali music?',
    backgrounds: {
      somali_performer_pro: 'I perform Somali music professionally',
      somali_performer: 'I play or sing Somali music (not professionally)',
      somali_listener: 'I listen to Somali music but do not perform it',
      other_musician: 'I am a musician from another tradition',
      other: 'Other',
    },
    instrument: 'Your main instrument or voice (optional)',
    years: 'Years playing or singing (optional)',
    familiarity: 'How well do you know qaraami and heello?',
    familiarityEnds: ['not at all', 'very well'],
    playbackQ: 'How are you listening?',
    playback: {
      headphones: 'Headphones or earbuds',
      speakers: 'Speakers',
      phone_speaker: 'Phone speaker',
    },
    start: 'Start listening',
    resume: 'Continue where you stopped',
    pairOf: (n, t) => `Pair ${n} of ${t}`,
    clip: (s) => `Clip ${s}`,
    listenFirst: 'Play both clips (at least a few seconds each) before answering.',
    somaliQ: 'Which sounds more like Somali music?',
    somali: { a: 'A', b: 'B', same: 'About the same', neither: 'Neither sounds Somali' },
    qualityQ: 'Which sounds better as a recording (clean, musical)?',
    quality: { a: 'A', b: 'B', same: 'About the same' },
    next: 'Next pair',
    finish: 'Finish',
    commentQ: 'Anything you want to tell us? (optional)',
    send: 'Send answers',
    sending: 'Sending…',
    thanks: 'Thank you. Your answers were saved.',
    share: 'Know another musician who knows Somali music? Send them this page.',
    failed: 'Your answers could not be sent. Download them and send the file to Khalid Ibrahim.',
    download: 'Download my answers',
    aiNote: 'Every clip is AI-generated. None is a real recording of a person.',
  },
  so: {
    langSwitch: 'English',
    title: 'Ma u egyahay muusig Soomaali?',
    intro: (n) =>
      `QaraamiGen waxay moodeelo AI ah ku tababartaa muusigga Soomaaliyeed, fannaaniinta oo keliya ayaana go'aamin kara inay shaqeeyaan. Waxaad maqli doontaa ${n} lammaane oo ah jajabyo gaagaaban oo AI sameeyay (10–20 ilbiriqsi midkiiba). Lammaane kasta, dooro midka uga eg muusigga Soomaaliga, iyo midka duubis ahaan ka wanaagsan. Waxay qaadanaysaa qiyaastii 10 daqiiqo. Dhegaha-ku-xidhku (headphones) wuu caawinayaa.`,
    privacy:
      "Magac la'aan: ma weydiinno magacaaga ama iimaylkaaga, mana kaydinno cinwaanka IP-gaaga. Jawaabahaaga waxaa loo isticmaalayaa cilmi-baadhistan oo keliya, waxaana laga yaabaa in wadarta la daabaco.",
    consent: 'Waxaan ahay 18 jir ama ka weyn, waxaanan ogolahay inaan ka qayb qaato.',
    backgroundQ: 'Sidee u taqaannaa muusigga Soomaaliyeed?',
    backgrounds: {
      somali_performer_pro: 'Muusigga Soomaaliga si xirfad ah ayaan u tumaa ama u qaadaa',
      somali_performer: 'Muusigga Soomaaliga waan tumaa ama qaadaa (xirfad ma aha)',
      somali_listener: 'Muusigga Soomaaliga waan dhegeystaa, laakiin ma tumo',
      other_musician: 'Waxaan ahay fannaan dhaqan kale ah',
      other: 'Wax kale',
    },
    instrument: 'Aaladdaada ugu muhiimsan ama codkaaga (ikhtiyaari)',
    years: 'Imisa sano ayaad tumaysay ama heesaysay? (ikhtiyaari)',
    familiarity: "Intee in le'eg ayaad u taqaannaa qaraamiga iyo heellada?",
    familiarityEnds: ['haba yaraatee', 'si fiican'],
    playbackQ: 'Maxaad ku dhegeysanaysaa?',
    playback: {
      headphones: 'Dhegaha-ku-xidh (headphones)',
      speakers: 'Sameecado (speakers)',
      phone_speaker: 'Sameecadda taleefanka',
    },
    start: 'Bilow dhegeysiga',
    resume: 'Ka sii wad meeshii aad ka joogsatay',
    pairOf: (n, t) => `Lammaanaha ${n} ee ${t}`,
    clip: (s) => `Jajabka ${s}`,
    listenFirst: 'Dhegeyso labada jajab (ugu yaraan dhowr ilbiriqsi midkiiba) intaadan jawaabin.',
    somaliQ: 'Kee baa uga eg muusigga Soomaaliga?',
    somali: { a: 'A', b: 'B', same: 'Waa isku mid', neither: 'Midna uma eka Soomaali' },
    qualityQ: 'Kee baa duubis ahaan ka wanaagsan (nadiif, muusig ahaan)?',
    quality: { a: 'A', b: 'B', same: 'Waa isku mid' },
    next: 'Lammaanaha xiga',
    finish: 'Dhammee',
    commentQ: 'Ma jiraa wax aad noo sheegi lahayd? (ikhtiyaari)',
    send: 'Dir jawaabaha',
    sending: 'Waa la dirayaa…',
    thanks: 'Mahadsanid. Jawaabahaaga waa la kaydiyay.',
    share: 'Ma taqaannaa fannaan kale oo yaqaanna muusigga Soomaaliga? U dir boggan.',
    failed: 'Jawaabahaaga lama diri karin. Soo deji oo faylka u dir Khalid Ibrahim.',
    download: 'Soo deji jawaabahayga',
    aiNote: 'Jajab kasta waxaa sameeyay AI. Midna maaha duubis dhab ah oo qof.',
  },
};
