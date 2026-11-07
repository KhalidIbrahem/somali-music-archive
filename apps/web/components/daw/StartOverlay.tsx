'use client';

/**
 * StartOverlay (Studio v3) — the first screen, in the spirit of GarageBand's
 * project chooser: five ways in. Each card sets a studio mode (which panes
 * open, which bottom tab shows) and closes. The project behind it is already
 * loaded, so "Continue" is always one tap away.
 */

export type StudioMode = 'create' | 'play' | 'learn' | 'listen' | 'record';

export interface ModeCard {
  id: StudioMode;
  title: string;
  somali: string;
  text: string;
  glyph: string;
}

export const MODE_CARDS: readonly ModeCard[] = [
  {
    id: 'create',
    title: 'Create',
    somali: 'Abuur',
    text: 'Arrange oud, durbaan, bass and keys on the timeline; loops, markers, mixer, export.',
    glyph: '▤',
  },
  {
    id: 'play',
    title: 'Play',
    somali: 'Ciyaar',
    text: 'An on-screen kaban keyboard locked to the qaraami scale, and durbaan pads.',
    glyph: '♪',
  },
  {
    id: 'learn',
    title: 'Learn',
    somali: 'Baro',
    text: 'The scale, the rhythms, Beerdilaacshe phrase by phrase, and the reverse dictionary.',
    glyph: '✎',
  },
  {
    id: 'listen',
    title: 'Listen',
    somali: 'Dhageyso',
    text: 'Every published QaraamiGen generation — browse, play, measure its pitch, add to a track.',
    glyph: '◉',
  },
  {
    id: 'record',
    title: 'Record',
    somali: 'Duub',
    text: 'Check the microphone, count in, record a take; then transcribe it or practise it slowed down.',
    glyph: '●',
  },
];

export function StartOverlay({
  projectName,
  onPick,
  onOpenProjects,
  onContinue,
  onHideForever,
}: {
  projectName: string;
  onPick: (mode: StudioMode) => void;
  onOpenProjects: () => void;
  onContinue: () => void;
  onHideForever: () => void;
}): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-page/92 p-4 backdrop-blur-sm"
      role="dialog"
      aria-label="Start"
    >
      <div className="w-full max-w-4xl">
        <p className="numeric text-center text-[10px] tracking-[0.24em] text-accent-state uppercase">
          QaraamiGenAI Studio
        </p>
        <h1 className="mt-2 text-center font-display text-3xl text-hi sm:text-4xl">
          What would you like to do?
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-mid">
          A studio for Somali music: create, play, learn, listen and record — all in the browser,
          nothing uploaded. Every pane is one tap away later.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {MODE_CARDS.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => onPick(card.id)}
              className="group flex min-h-40 flex-col items-start gap-2 rounded-[6px] border border-hairline bg-chrome-1 p-4 text-left transition-colors hover:border-accent-state hover:bg-chrome-2 focus-visible:border-accent-state focus-visible:outline-none"
            >
              <span
                aria-hidden
                className="font-display text-2xl leading-none text-accent-state transition-transform group-hover:scale-110 motion-reduce:transition-none"
              >
                {card.glyph}
              </span>
              <span className="font-display text-xl text-hi">{card.title}</span>
              <span className="numeric -mt-1 text-[10px] tracking-[0.16em] text-accent-state uppercase">
                {card.somali}
              </span>
              <span className="text-[12px] leading-snug text-mid">{card.text}</span>
            </button>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onContinue}
            className="h-9 rounded-[4px] bg-accent-state px-4 text-sm font-semibold text-page hover:brightness-110"
          >
            Continue “{projectName}”
          </button>
          <button
            type="button"
            onClick={onOpenProjects}
            className="h-9 rounded-[4px] border border-hairline px-4 text-sm text-mid hover:border-accent-state hover:text-hi"
          >
            Open a project…
          </button>
          <button
            type="button"
            onClick={onHideForever}
            className="numeric h-9 px-3 text-[10px] tracking-[0.14em] text-low uppercase hover:text-hi"
          >
            Don’t show this again
          </button>
        </div>
      </div>
    </div>
  );
}
