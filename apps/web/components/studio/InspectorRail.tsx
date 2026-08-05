/**
 * Inspector rail (320px): what the pipeline detected — instrument, pentatonic
 * root and scale degrees, quantization grid, confidence distribution, and the
 * selected note's detail. Values here are the real output of the sample
 * session's notation job; the live selection wiring lands in B1-05/06.
 *
 * §3: the key slot shows the detected pentatonic root and degrees, never a
 * forced Western key signature.
 */

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-8 items-center justify-between gap-2 px-4">
      <span className="text-xs text-low">{label}</span>
      <span className="text-right text-[13px] text-hi">{children}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <h2 className="flex h-8 items-center px-4 text-[11px] font-semibold tracking-[0.08em] text-low uppercase">
      {children}
    </h2>
  );
}

/** Real distribution of the sample session: 165 / 115 / 132 of 412 notes. */
const CONFIDENCE_BANDS = [
  { label: '≥ 0.90', count: 165, alphaClass: 'opacity-100' },
  { label: '0.70–0.89', count: 115, alphaClass: 'opacity-[0.62]' },
  { label: '< 0.70', count: 132, alphaClass: 'opacity-[0.34]' },
] as const;

const TOTAL_NOTES = 412;

export function InspectorRail(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col overflow-y-auto py-2">
      <SectionTitle>Instrument</SectionTitle>
      <Row label="Source">Voice — codka</Row>
      <Row label="Separation">Vocals isolated</Row>

      <div className="mx-4 my-2 h-px bg-hairline" aria-hidden />

      <SectionTitle>Detected scale</SectionTitle>
      <Row label="Pentatonic root">
        <span className="font-display text-base">A</span>
      </Row>
      <Row label="Scale degrees">
        <span className="numeric">2 · 4 · 7 · 9 · 11</span>
      </Row>
      <Row label="Tuning offset">
        <span className="numeric">+41.6¢</span>
      </Row>

      <div className="mx-4 my-2 h-px bg-hairline" aria-hidden />

      <SectionTitle>Quantization</SectionTitle>
      <Row label="Grid">Beat-tracked</Row>
      <Row label="Tempo">
        <span className="numeric">106 BPM</span>
      </Row>
      <Row label="Snapped notes">
        <span className="numeric">313 of 412</span>
      </Row>

      <div className="mx-4 my-2 h-px bg-hairline" aria-hidden />

      <SectionTitle>Confidence</SectionTitle>
      <Row label="Mean">
        <span className="numeric">0.68</span>
      </Row>
      <div className="px-4 py-2">
        <div
          role="img"
          aria-label="Confidence distribution: 165 notes at or above 0.90, 115 between 0.70 and 0.89, 132 below 0.70"
          className="flex h-2 w-full gap-px overflow-hidden rounded-full"
        >
          {CONFIDENCE_BANDS.map((band) => (
            <span
              key={band.label}
              className={`h-full bg-hi ${band.alphaClass}`}
              style={{ width: `${(band.count / TOTAL_NOTES) * 100}%` }}
            />
          ))}
        </div>
        <div className="mt-2 space-y-1">
          {CONFIDENCE_BANDS.map((band) => (
            <div key={band.label} className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-2 text-low">
                <span aria-hidden className={`h-2 w-2 rounded-[2px] bg-hi ${band.alphaClass}`} />
                <span className="numeric">{band.label}</span>
              </span>
              <span className="numeric text-mid">{band.count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-4 my-2 h-px bg-hairline" aria-hidden />

      <SectionTitle>Note detail</SectionTitle>
      <p className="px-4 py-2 text-[13px] leading-relaxed text-low">
        Select a note to inspect its pitch, timing, and confidence.
      </p>
    </div>
  );
}
