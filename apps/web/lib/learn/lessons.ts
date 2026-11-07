/**
 * Learn-mode lesson texts (Studio v3). Every claim here is either taken from
 * documented material already published by this project (the Beerdilaacshe
 * score page, the Listen page's Radio Hargeysa biographies, the model and
 * data documentation) or is marked in the glossary with its source. Nothing
 * here is a recording; the studio's instruments and the published model
 * output are the only sounds.
 */

export interface LessonMeta {
  id: LessonId;
  title: string;
  somali: string;
  summary: string;
  minutes: number;
}

export type LessonId = 'qaamuus' | 'scale' | 'rhythm' | 'melody' | 'history';

export const LESSONS: readonly LessonMeta[] = [
  {
    id: 'qaamuus',
    title: 'Qaamuus — the reverse dictionary',
    somali: 'Qaamuuska fanka',
    summary:
      'Describe a sound, an instrument, a form or a person in English or Somali and find the Somali term, with its sources.',
    minutes: 5,
  },
  {
    id: 'scale',
    title: 'The qaraami scale',
    somali: 'Laxanka shan-dhawaaqle',
    summary:
      'The five-note pentatonic set every qaraami melody lives on: hear its five modes, find the root, play along with the lock on.',
    minutes: 8,
  },
  {
    id: 'rhythm',
    title: 'Somali rhythms on the durbaan',
    somali: 'Garaaca durbaanka',
    summary:
      'Dum, tak and slap; the heello, dhaanto, jiifto and Banaadiri grooves; tap along and see your timing.',
    minutes: 10,
  },
  {
    id: 'melody',
    title: 'Learn Beerdilaacshe',
    somali: 'Baro Beerdilaacshe',
    summary:
      'Abdillahi Qarshe’s 1950s melody, phrase by phrase: listen slowed down, play it back, and see how close you were.',
    minutes: 15,
  },
  {
    id: 'history',
    title: 'Radio Hargeysa and the qaraami era',
    somali: 'Taariikhda',
    summary:
      'From the balwo of the 1940s to the heello and the national troupes: the people and institutions behind the sound.',
    minutes: 6,
  },
];

export const SCALE_LESSON = {
  intro:
    'Somali qaraami, heello and most of the dance repertoire are built on the anhemitonic pentatonic set: five notes to the octave with no semitone steps. The same five notes heard from a different starting note make a different mode — the studio names the five rotations after their Western pentatonic equivalents.',
  steps: [
    'Choose a root. The root is the note the melody keeps returning to and ends on; our captions call it “rooted on A”.',
    'Press Play on a mode to hear its five notes rise to the octave on the oud voice.',
    'Switch the scale lock on with that mode. The keyboard, musical typing and the piano roll now only offer in-scale notes.',
    'Open Play and improvise on the scale-only keyboard: every key you press belongs to the mode, so listen for the character of each degree rather than hunting for right notes.',
    'Real recordings are rarely exactly in tune with A = 440 Hz. The Pitch tab measures a clip’s tuning offset in cents and marks off-scale notes instead of hiding them.',
  ],
  note: 'Mode names are a convenience: Somali musicians name songs, roots and moods, not scales. The glossary entries laxan, luuq and dhawaaq hold the Somali words that are documented.',
} as const;

export const RHYTHM_LESSON = {
  intro:
    'The durbaan (frame drum) carries the pulse. Three strokes are enough for a groove: dum, the deep centre stroke; tak, the bright rim stroke; and the slap in between. The presets are stylised one-bar patterns named after Somali rhythmic families — starting points to edit in the step grid, not transcriptions.',
  steps: [
    'Pick a groove and press Listen: it plays one bar at the project tempo, twice.',
    'Choose which lane to practise — the dum strokes alone are the easiest — and tap along on the pad, on the space bar, or on any key while the pattern plays.',
    'Your taps are matched to the nearest expected stroke within 120 ms. Green is on time; the score and the early/late bias tell you where to listen.',
    'Browser input adds a few tens of milliseconds of delay on most machines. If every tap reads “late” by the same amount, that is the device, not you — the trainer subtracts your average offset when you switch on Calibrate.',
  ],
} as const;

export const MELODY_LESSON = {
  intro:
    'Beerdilaacshe is a qaraami melody composed by Abdillahi Qarshe in the 1950s, engraved for this archive by Khalid Ibrahim from a transcription and performed here by the studio’s own oud voice — there is no recording in this lesson. Learn it the way qaraami was always learnt, by ear and phrase by phrase.',
  steps: [
    'Choose a phrase. Listen at 50 % or 75 % with the loop on until you can hum it.',
    'Press Play along: the metronome counts a bar in, then play the phrase on the keyboard, musical typing or a MIDI instrument.',
    'The score compares what you played with the engraved notes — pitch (octave does not matter), timing within an eighth note, and whether you played every note — and shows each note green, amber or red.',
    'When a phrase reads “excellent”, move to the next one; the final step chains them into the whole melody.',
  ],
} as const;

export interface HistoryParagraph {
  heading: string;
  text: string;
  glossary: string[];
}

export const HISTORY_LESSON: readonly HistoryParagraph[] = [
  {
    heading: 'The balwo (1940s)',
    text: 'Around 1943–1945, in the Borama–Hargeysa area, Cabdi Deeqsi “Sinimo” began singing short love lyrics to simple tunes. The balwo was tiny — two to four lines — and scandalously secular, and it spread with the lorries and the first radio sets. Modern Somali song begins here.',
    glossary: ['balwo', 'cabdi-sinimo'],
  },
  {
    heading: 'Radio Hargeysa and the heello (1950s)',
    text: 'Radio Hargeysa gave the balwo a studio and an audience. Poets lengthened it, composers set it to the kaban (oud) and small ensembles, and the refrain “heelloy heellelloy” that opened performances named the new form: the heello. Cabdullaahi Qarshe, composer and kaban player, is honoured as the father of modern Somali music; his melody Beerdilaacshe is the one this studio teaches.',
    glossary: ['heello', 'idaacadda-hargeysa', 'cabdullaahi-qarshe', 'kaban', 'walaalo-hargeysa'],
  },
  {
    heading: 'Qaraami: the sound of a generation',
    text: 'The love songs of the 1950s–1970s, sung over the kaban in a free, ornamented line on the pentatonic scale, became known as qaraami, from the Arabic word for passionate love. Singers and oud masters such as Cumar Dhuule and Maxamed Mooge Liibaan recorded the definitive takes at Radio Hargeysa.',
    glossary: ['qaraami', 'cumar-dhuule', 'maxamed-mooge', 'laxan'],
  },
  {
    heading: 'Independence, Radio Muqdisho and Waaberi (1960s–1980s)',
    text: 'After 1960 the state took music under its wing: Radio Muqdisho’s orchestra, the National Theatre (1967) and the national troupe Hobollada Waaberi staged musical plays whose songs the whole country learnt. Guitars, organs and brass joined the kaban; patriotic songs stood beside the love songs. Magool, Maryan Mursal, Hasan Aadan Samatar and Saado Cali Warsame belong to this era.',
    glossary: [
      'waaberi',
      'riwaayad',
      'idaacadda-muqdisho',
      'tiyaatarka-qaranka',
      'hees-wadani',
      'magool',
    ],
  },
  {
    heading: 'Cassettes, war and the archive',
    text: 'From the 1970s the music travelled on cassettes, and when the radio archives were scattered or destroyed in the civil war, the cassettes kept in homes and shops became the record of the era. Digitising, describing and learning from those tapes — with the rights of their performers respected — is what this archive is for.',
    glossary: ['cajalad', 'kayd', 'hidde', 'hiddo-dhawr'],
  },
];
