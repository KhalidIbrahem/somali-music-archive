'use client';

/**
 * Inspector rail (320px): what the pipeline detected — instrument, pentatonic
 * root and scale degrees, quantization grid, confidence distribution, and the
 * selected note's detail. Everything reads from the loaded session; the live
 * note selection wires in with the shared timeline (B1-05/06).
 *
 * §3: the key slot shows the detected pentatonic root and degrees, never a
 * forced Western key signature.
 */

import { confidenceTier } from '@sma/constants';
import { useStudio } from './StudioState';
import { formatClock, midiToHz, midiToName } from './format';

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

function Divider(): React.JSX.Element {
  return <div className="mx-4 my-2 h-px bg-hairline" aria-hidden />;
}

const TIER_ROWS = [
  { tier: 'high', label: '≥ 0.90', alphaClass: 'opacity-100' },
  { tier: 'mid', label: '0.70–0.89', alphaClass: 'opacity-[0.62]' },
  { tier: 'low', label: '< 0.70', alphaClass: 'opacity-[0.34]' },
] as const;

export function InspectorRail(): React.JSX.Element {
  const { session, selectedNote } = useStudio();
  const meta = session?.meta;

  const counts = { high: 0, mid: 0, low: 0 };
  if (session !== null) {
    for (const n of session.notes) counts[confidenceTier(n.confidence)] += 1;
  }
  const total = session?.notes.length ?? 0;
  const note = selectedNote === null ? undefined : session?.notes[selectedNote];

  return (
    <div className="flex h-full flex-col overflow-y-auto py-2">
      <SectionTitle>Instrument</SectionTitle>
      <Row label="Source">{meta?.instrument ?? '—'}</Row>
      <Row label="Separation">Vocals isolated</Row>

      <Divider />

      <SectionTitle>Detected scale</SectionTitle>
      <Row label="Pentatonic root">
        <span className="font-display text-base">{meta?.tonic ?? '—'}</span>
      </Row>
      <Row label="Scale degrees">
        <span className="numeric">{meta === undefined ? '—' : meta.degrees.join(' · ')}</span>
      </Row>
      <Row label="Tuning offset">
        <span className="numeric">{meta === undefined ? '—' : `+${meta.tuningOffsetCents}¢`}</span>
      </Row>

      <Divider />

      <SectionTitle>Quantization</SectionTitle>
      <Row label="Grid">{meta?.grid ?? '—'}</Row>
      <Row label="Tempo">
        <span className="numeric">{meta === undefined ? '—' : `${meta.bpm} BPM`}</span>
      </Row>
      <Row label="Snapped notes">
        <span className="numeric">
          {meta === undefined ? '—' : `${meta.snapped} of ${meta.nNotes}`}
        </span>
      </Row>

      <Divider />

      <SectionTitle>Confidence</SectionTitle>
      <Row label="Mean">
        <span className="numeric">{meta === undefined ? '—' : meta.meanConfidence.toFixed(2)}</span>
      </Row>
      {total > 0 && (
        <div className="px-4 py-2">
          <div
            role="img"
            aria-label={`Confidence distribution: ${counts.high} notes at or above 0.90, ${counts.mid} between 0.70 and 0.89, ${counts.low} below 0.70`}
            className="flex h-2 w-full gap-px overflow-hidden rounded-full"
          >
            {TIER_ROWS.map((row) => (
              <span
                key={row.tier}
                className={`h-full bg-hi ${row.alphaClass}`}
                style={{ width: `${(counts[row.tier] / total) * 100}%` }}
              />
            ))}
          </div>
          <div className="mt-2 space-y-1">
            {TIER_ROWS.map((row) => (
              <div key={row.tier} className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-2 text-low">
                  <span aria-hidden className={`h-2 w-2 rounded-[2px] bg-hi ${row.alphaClass}`} />
                  <span className="numeric">{row.label}</span>
                </span>
                <span className="numeric text-mid">{counts[row.tier]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Divider />

      <SectionTitle>Note detail</SectionTitle>
      {note === undefined ? (
        <p className="px-4 py-2 text-[13px] leading-relaxed text-low">
          Select a note to inspect its pitch, timing, and confidence.
        </p>
      ) : (
        <>
          <Row label="Pitch">
            <span>
              {midiToName(note.midi)}{' '}
              <span className="numeric text-mid">
                {midiToHz(note.midi, session?.meta.tuningOffsetCents ?? 0)} Hz
              </span>
            </span>
          </Row>
          <Row label="Onset">
            <span className="numeric">{formatClock(note.start)}</span>
          </Row>
          <Row label="Duration">
            <span className="numeric">{(note.end - note.start).toFixed(3)}s</span>
          </Row>
          <Row label="Confidence">
            <span className="numeric">{note.confidence.toFixed(2)}</span>
          </Row>
          <Row label="Grid">{note.snapped ? 'Snapped to beat' : 'Marked outlier'}</Row>
        </>
      )}
    </div>
  );
}
