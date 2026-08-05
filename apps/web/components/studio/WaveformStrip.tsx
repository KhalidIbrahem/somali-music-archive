/**
 * Waveform strip (96px) — shares the score's time axis and cursor (§2).
 * B1-02 renders the empty track bed; peaks render in B1-04 and the shared
 * cursor binds in B1-05.
 */

export function WaveformStrip(): React.JSX.Element {
  return (
    <section
      aria-label="Waveform"
      className="relative h-(--studio-waveform) shrink-0 border-t border-hairline bg-chrome-1 print:hidden"
    >
      <div className="absolute inset-x-0 top-1/2 h-px bg-hairline" aria-hidden />
      <p className="absolute top-2 left-4 text-[11px] text-low">
        Audio loads with the score in the next step.
      </p>
    </section>
  );
}
