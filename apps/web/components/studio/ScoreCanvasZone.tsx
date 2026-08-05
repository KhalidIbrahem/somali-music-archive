'use client';

/**
 * Score canvas zone — the lit object of the studio: cream paper floating on
 * dark chrome, framed like a manuscript under glass (§2). This is the only
 * scrollable region in the shell. The title block reads the session's real
 * detection results (§3: detected pentatonic root, never a forced Western
 * key signature).
 *
 * On print, the paper is the page: chrome dies away via print:hidden on the
 * surrounding zones and the canvas loses its glass frame.
 */

import { ScoreCanvas } from './ScoreCanvas';
import { useStudio } from './StudioState';

export function ScoreCanvasZone(): React.JSX.Element {
  const { session, sessionStatus } = useStudio();

  return (
    <div data-score-scroll className="min-h-0 flex-1 overflow-auto bg-page print:overflow-visible">
      <div className="mx-auto my-8 w-fit min-w-[520px] rounded-[2px] bg-paper shadow-2xl ring-1 ring-paper-edge print:my-0 print:min-w-0 print:shadow-none print:ring-0">
        <div className="px-16 pt-14 pb-6 text-center">
          <p className="text-[11px] tracking-[0.2em] text-confidence-mid uppercase">
            Somali Music Archive — transcription
          </p>
          <h2 className="mt-4 font-display text-3xl text-confidence-high">
            {session?.meta.title ?? 'Sample session'}
          </h2>
          <p className="numeric mt-2 text-xs text-confidence-mid">
            {session === null
              ? '—'
              : `${session.meta.instrument} · pentatonic root ${session.meta.tonic} ` +
                `(+${session.meta.tuningOffsetCents}¢) · ${session.meta.bpm} BPM · ${session.meta.grid}`}
          </p>
        </div>

        {sessionStatus === 'error' ? (
          <p className="px-16 pb-16 text-center text-sm text-confidence-mid">
            The session data could not load. Reload the page to try again.
          </p>
        ) : (
          <ScoreCanvas />
        )}
      </div>
    </div>
  );
}
