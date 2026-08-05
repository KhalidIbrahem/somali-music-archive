/**
 * Score canvas zone — the lit object of the studio: cream paper floating on
 * dark chrome, framed like a manuscript under glass (§2). This is the only
 * scrollable region in the shell. B1-02 renders the empty paper; Verovio
 * engraving mounts here in B1-03.
 *
 * On print, the paper is the page: chrome dies away via print:hidden on the
 * surrounding zones and the canvas loses its glass frame.
 */

export function ScoreCanvasZone(): React.JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-page print:overflow-visible">
      <div className="mx-auto my-8 w-[820px] max-w-[calc(100%-4rem)] rounded-[2px] bg-paper shadow-2xl ring-1 ring-paper-edge print:my-0 print:w-full print:max-w-none print:shadow-none print:ring-0">
        <div className="px-16 pt-14 pb-10 text-center">
          <p className="text-[11px] tracking-[0.2em] text-confidence-mid uppercase">
            Somali Music Archive — transcription
          </p>
          <h2 className="mt-4 font-display text-3xl text-confidence-high">Sample session</h2>
          <p className="numeric mt-2 text-xs text-confidence-mid">
            Voice · pentatonic root A · 106 BPM · beat-tracked
          </p>
        </div>
        {/* Engraved score mounts here in B1-03. Keep the paper honest until
            then: no fake staves, just the empty page. */}
        <div className="min-h-[720px]" aria-hidden />
      </div>
    </div>
  );
}
