/**
 * TranscribeExamples (/transcribe with NEXT_PUBLIC_AI_SERVICE_MODE=off).
 *
 * The public site has no transcription service behind it: the pipeline runs on
 * the research workstation. This page shows three of its scores, rendered
 * ahead of time as PDFs (first page previewed), with the scale the pipeline
 * fitted to each recording. No recording is included. Server component.
 */

import Image from 'next/image';
import { TRANSCRIPTION_EXAMPLES, formatClock } from '@/lib/demoExamples';

export function TranscribeExamples(): React.JSX.Element {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <p className="font-body text-sm uppercase tracking-[0.3em] text-amber">Qormada</p>
      <h1 className="mt-2 font-display text-4xl text-ink-primary">Audio → sheet music</h1>
      <p className="mt-3 max-w-2xl font-body text-ink-secondary">
        The transcription pipeline runs on the research workstation, not on this site. Below are
        three of its scores, rendered ahead of time. Each recording&apos;s scale is detected from
        the audio itself and written in cents above the tonic; notes outside that scale are{' '}
        <span className="text-danger">kept and marked</span> with their deviation, because ornaments
        and microtonal inflections are music, not errors.
      </p>

      <ol className="mt-10 flex flex-col gap-10">
        {TRANSCRIPTION_EXAMPLES.map((ex) => (
          <li
            key={ex.slug}
            className="grid gap-6 rounded-2xl border border-line-secondary bg-bg-secondary p-6 lg:grid-cols-[1fr_320px]"
          >
            <div className="min-w-0">
              <h2 className="font-display text-2xl text-ink-primary">{ex.title}</h2>
              <p className="mt-1 font-body text-sm text-ink-secondary">
                {ex.source} · {formatClock(ex.durationSec)}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Tonic" value={ex.tonic} />
                <Stat label="Scale, cents" value={ex.scaleCents.join(' / ')} />
                <Stat label="Tempo" value={`${ex.bpm} BPM`} />
                <Stat label="Notes" value={`${ex.notes}`} />
              </div>
              <p className="mt-3 font-body text-sm text-ink-secondary">
                {ex.staves.join(' and ')} ·{' '}
                <span className="text-danger">
                  {ex.marked} notes off the scale, kept and marked
                </span>{' '}
                · automatic transcription, unverified
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <a
                  href={ex.pdf}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-amber/40 px-4 py-2 font-body text-sm font-semibold text-amber transition-colors hover:bg-amber hover:text-bg-primary"
                >
                  Open the PDF
                </a>
                <a
                  href={ex.pdf}
                  download
                  className="rounded-lg border border-line-primary px-4 py-2 font-body text-sm text-ink-secondary transition-colors hover:text-ink-primary"
                >
                  Download
                </a>
              </div>
            </div>
            <a
              href={ex.pdf}
              target="_blank"
              rel="noreferrer"
              aria-label={`${ex.title}, first page of the score`}
              className="block overflow-hidden rounded-lg bg-bg-inverse ring-1 ring-line-primary"
            >
              <Image
                src={ex.preview.src}
                alt={`First page of the ${ex.title} score`}
                width={ex.preview.width}
                height={ex.preview.height}
                sizes="(min-width: 1024px) 320px, 100vw"
                className="h-auto w-full"
              />
            </a>
          </li>
        ))}
      </ol>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-line-secondary bg-bg-tertiary px-4 py-3">
      <p className="font-body text-xs uppercase tracking-wider text-ink-tertiary">{label}</p>
      <p className="mt-1 font-display text-lg text-amber">{value}</p>
    </div>
  );
}
