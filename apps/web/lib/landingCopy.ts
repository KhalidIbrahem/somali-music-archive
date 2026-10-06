/**
 * Landing copy — SINGLE SOURCE for every string on the landing page.
 *
 * PROVENANCE: strings trace to the approved copy bank
 * (`QaraamiGen-landing-copy.md`), to the QaraamiGen build brief's own story
 * text and the shipped B1-12 landing lines, or to verifiable project numbers
 * (audio inventory, sample session, corpus pipeline). Nothing here is invented
 * marketing. The page reads EXCLUSIVELY from this file — to change wording,
 * edit strings here only. Commented `// alt:` lines are approved alternatives
 * from the copy bank; swap one in by moving it into the active string.
 *
 * DO NOT change the `stats` numbers without updating the source data — they
 * are real figures, not copy.
 */

export const landingCopy = {
  hero: {
    // Situation → stakes → turn. Author's story framing (build brief):
    // oral tradition, live performance, aging cassettes; never written down.
    kicker: 'Qaraami — the golden age, 1970s–1980s',
    // Author's final copy (website-v1, 2026-09-27) — verbatim.
    headline: 'A music this beautiful, with no sheet to play from.',
    sub: 'When my teacher and I went looking for Somali sheet music, there was none. So I combined AI and my own music training so people and machines can finally read, play, and understand Somali music.',
    // Earlier lines kept for the record:
    // headline: 'A nation’s memory, held together by cassette tape.'
    // sub: 'Almost none of it was ever written into sheet music — and the recordings are decaying a little more each year.'
    // turn: 'Until now.' — dropped: the new subline already lands the turn.
    // The three pillars, named in the author's own master-plan brief
    // (2026-08-08): "transcription of 1950s qaraami scores, playable sheet
    // music, and a professional DAW dedicated to Somali music."
    pillars: [
      'Transcription of 1950s qaraami scores',
      'Playable sheet music',
      'A professional studio (DAW) dedicated to Somali music',
    ],
  },

  proof: {
    // The engraved excerpt that plays (B1-10/11) — the page's proof moment.
    kicker: 'From a recording to a page',
    title: 'Sheet music that draws itself from the sound',
    // alt: 'Watch a melody become memory.'
    body: 'Press play. The engraving follows the audio note by note — the same binding the studio uses on full recordings.',
  },

  sections: [
    {
      id: 'tapes',
      kicker: 'Radio Hargeisa & the archive',
      title:
        'For generations, qaraami lived in voices, live performances, and the master reels of Radio Hargeisa.',
      body: 'Born in Hargeisa with the 1943 invention of the Balwo and broadcast on Radio Hargeisa, classical Somali music lived on magnetic reels and cassettes. In 1988, station custodians heroically buried thousands of master tapes underground to save them from bombardment. Today, the hiss grows louder and magnetic tape decays — what was saved from the sands must now be written into score before it fades.',
    },
    {
      id: 'writing',
      kicker: 'The work',
      title: 'Writing it down, honestly.',
      body: 'The pipeline separates the voice from the band, finds the pentatonic root, scale degrees, and beat grid, then engraves the melody as sheet music you can play, print, or export. Where the model is less certain, it prints lighter ink instead of pretending — the score never claims more than the recording gives it.',
    },
    {
      id: 'doubt',
      kicker: 'The signature',
      title: 'A score that admits doubt.',
      body: 'Every note carries the confidence of its own transcription: full ink at certainty, fading ink where the tape fades. Uncertainty is stated on the page, the way a careful edition would state it.',
    },
    {
      id: 'archive',
      kicker: 'The archive',
      title: 'Not a product. A record.',
      body: 'A listening room with every source stated plainly. A studio where the score, the waveform, and the recording share one cursor. A research corpus behind both — across AI, computational ethnomusicology, and cultural preservation.',
    },
  ],

  // Real, verifiable numbers only (docs/audio-inventory.md, corpus pipeline,
  // sample session). Update when the numbers move. NOT marketing copy.
  stats: [
    { value: '605', label: 'recordings surveyed in the research corpus' },
    { value: '105', label: 'cassette tracks digitised and on hand' },
    { value: '412', label: 'notes in the first end-to-end transcription' },
    { value: '0.68', label: 'its mean confidence — printed, not hidden' },
  ],

  // Research demos (author's master-plan brief, 2026-08-08: "Audio demos
  // section … each demo = title + paragraph. First demo: the Beerdilaacshe
  // oud + drum rendering". Section format after the author's reference,
  // mit.edu/~paris/demos.)
  demos: {
    kicker: 'Research demos',
    title: 'Listen to the work',
    intro:
      'Short audio results from the project, each with what it is and how it was made. More are added as the research moves.',
    film: {
      title: 'The studio, filmed',
      body: 'A screen recording of the QaraamiGenAI studio — composing with the oud and durbaan instruments — will sit here.',
      badge: 'Not yet recorded',
    },
  },

  closing: {
    title: 'Preserve, understand, and extend Somali musical heritage.',
    body: 'Nothing here will ever be lost again.',
    // alt body: 'The tapes will not wait. The writing down has begun.'
    primaryCta: 'Open the studio',
    secondaryCta: 'Enter the listening room',
    noteHint: 'End on a single held note',
  },

  // Author credit (master-plan brief: 'Credits: "Built by Khalid Ibrahim"').
  credit: 'Built by Khalid Ibrahim',
} as const;
