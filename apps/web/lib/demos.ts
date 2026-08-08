/**
 * Research-demo registry (SESSION "studio master plan", Stage 2).
 *
 * ADDING A DEMO is one entry here:
 *   • a plain audio file — drop it in `public/demos/audio/` (or anywhere under
 *     public/) and use `{ kind: 'file', src: '/demos/audio/my-demo.mp3' }`;
 *   • the in-browser Beerdilaacshe performance — `{ kind: 'engine', notesUrl }`
 *     renders the shared oud+durbaan engine (lib/audio/qaraamiEngine) live on
 *     the visitor's machine, so there is no audio file to host at all.
 *
 * Titles/paragraphs are demo METADATA (facts about each result), so they live
 * here beside their demo rather than in landingCopy.ts; section-level copy
 * (kicker/intro) stays in the copy bank.
 */

export type DemoSource =
  | { readonly kind: 'file'; readonly src: string }
  | { readonly kind: 'engine'; readonly notesUrl: string };

export interface ResearchDemo {
  readonly slug: string;
  readonly title: string;
  /** One short paragraph: what this is and how it was made. */
  readonly paragraph: string;
  /** Attribution line shown under the player. */
  readonly credit?: string;
  readonly source: DemoSource;
}

export const RESEARCH_DEMOS: readonly ResearchDemo[] = [
  {
    slug: 'beerdilaacshe',
    title: 'Beerdilaacshe — oud and durbaan, performed by the engine',
    paragraph:
      'The melody was engraved as sheet music, parsed from its MIDI into 126 timed notes, and is performed here live in your browser by the platform’s own instruments: a plucked-string oud voice (a doubled course, two strings a few cents apart) over a durbaan frame-drum groove. Nothing is a recording — every note is synthesised the moment you press play.',
    credit: 'Composed by Abdillahi Qarshe, 1950s · Sheet music by Khalid Ibrahim',
    source: { kind: 'engine', notesUrl: '/scores/beerdilaacshe/notes.json' },
  },
];
