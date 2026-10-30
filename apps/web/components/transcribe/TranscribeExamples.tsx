/**
 * TranscribeExamples (/transcribe with NEXT_PUBLIC_AI_SERVICE_MODE=off).
 *
 * The public site has no transcription service behind it: the pipeline runs on
 * the research workstation. This page shows three of its scores, rendered
 * ahead of time as PDFs (first page previewed), with the scale the pipeline
 * fitted to each recording. No recording is included. Above them, the
 * in-browser transcriber (BrowserTranscriber) for the visitor's own audio. Also: Beerdilaacshe,
 * the hand-engraved score (playable MIDI), and an "open your own MusicXML"
 * viewer that engraves and plays a local file in the browser. Server component.
 */

import Image from 'next/image';
import { TRANSCRIPTION_EXAMPLES, formatClock } from '@/lib/demoExamples';
import { siteCopy } from '@/lib/siteCopy';
import { BrowserTranscriber } from './BrowserTranscriber';
import { MidiPlay } from './MidiPlay';
import { MusicXmlViewer } from './MusicXmlViewer';

export function TranscribeExamples(): React.JSX.Element {
  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-12">
      <p className="font-body text-sm uppercase tracking-[0.3em] text-amber">Qormada</p>
      <h1 className="mt-2 font-display text-3xl text-ink-primary sm:text-4xl">
        {siteCopy.transcribe.label}
      </h1>
      <p className="mt-3 max-w-2xl font-body text-ink-secondary">
        Write out the melody of any recording as sheet music, with the scale detected from the audio
        itself and the tuning in cents. Notes outside that scale are{' '}
        <span className="text-danger">kept and marked</span>, because ornaments and microtonal
        inflections are music, not errors.
      </p>

      <BrowserTranscriber />

      <h2 className="mt-12 font-display text-2xl text-ink-primary">From the research pipeline</h2>
      <p className="mt-2 max-w-2xl font-body text-sm text-ink-secondary">
        The full pipeline (CREPE pitch tracking, source separation) runs on the research
        workstation. Three of its scores, rendered ahead of time:
      </p>

      <MusicXmlViewer />

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
                  Download PDF
                </a>
                <a
                  href={ex.musicXml}
                  download
                  className="rounded-lg border border-line-primary px-4 py-2 font-body text-sm text-ink-secondary transition-colors hover:text-ink-primary"
                >
                  Download MusicXML
                </a>
                <a
                  href={ex.midi}
                  download
                  className="rounded-lg border border-line-primary px-4 py-2 font-body text-sm text-ink-secondary transition-colors hover:text-ink-primary"
                >
                  Download MIDI
                </a>
              </div>
              <p className="mt-2 font-body text-xs text-ink-tertiary">
                MusicXML opens in MuseScore and Logic Pro. Use MIDI for GarageBand.
              </p>
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
        <li className="grid gap-6 rounded-2xl border border-line-secondary bg-bg-secondary p-6 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0">
            <h2 className="font-display text-2xl text-ink-primary">Beerdilaacshe</h2>
            <p className="mt-1 font-body text-sm text-ink-secondary">
              melody by Abdillahi Qarshe (1950s) · engraved by Khalid Ibrahim · 96 BPM · 126 notes
            </p>
            <p className="mt-3 font-body text-sm text-ink-secondary">
              A hand-engraved score, not an automatic transcription. Press play to hear the score
              itself, played from its MIDI.
            </p>
            <div className="mt-4">
              <MidiPlay src="/scores/beerdilaacshe/Beerdilaacshe.midi" />
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <a
                href="/scores/beerdilaacshe"
                className="rounded-lg border border-amber/40 px-4 py-2 font-body text-sm font-semibold text-amber transition-colors hover:bg-amber hover:text-bg-primary"
              >
                Open the score page
              </a>
              <a
                href="/scores/beerdilaacshe/Beerdilaacshe.pdf"
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-line-primary px-4 py-2 font-body text-sm text-ink-secondary transition-colors hover:text-ink-primary"
              >
                PDF
              </a>
              <a
                href="/scores/beerdilaacshe/Beerdilaacshe.midi"
                download
                className="rounded-lg border border-line-primary px-4 py-2 font-body text-sm text-ink-secondary transition-colors hover:text-ink-primary"
              >
                MIDI
              </a>
            </div>
          </div>
          <a
            href="/scores/beerdilaacshe/Beerdilaacshe.pdf"
            target="_blank"
            rel="noreferrer"
            aria-label="Beerdilaacshe, first page of the score"
            className="block overflow-hidden rounded-lg bg-bg-inverse ring-1 ring-line-primary"
          >
            <Image
              src="/scores/beerdilaacshe/Beerdilaacshe.png"
              alt="First page of the Beerdilaacshe score"
              width={1400}
              height={1981}
              sizes="(min-width: 1024px) 320px, 100vw"
              className="h-auto w-full"
            />
          </a>
        </li>
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
