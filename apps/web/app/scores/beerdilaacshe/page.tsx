/**
 * /scores/beerdilaacshe — engraved sheet music for "Beerdilaacshe", a Qaraami
 * melody composed by Abdillahi Qarshe in the 1950s, transcribed and engraved
 * by Khalid Ibrahim.
 *
 * Layout order per the brief: title → credits → playable performance (oud-like
 * plucked synthesis + durbaan groove, no GM piano) → embedded PDF → downloads
 * (PDF / MIDI / LilyPond source). The player's note data is parsed from the
 * MIDI at build time by scripts/build-score.mjs into notes.json.
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { ScorePlayer, type ScoreData } from '@/components/scores/ScorePlayer';

export const metadata: Metadata = {
  title: 'Beerdilaacshe — Qaraami Melody',
  description:
    '“Beerdilaacshe” — a Qaraami melody composed by Abdillahi Qarshe in the 1950s. Sheet music transcribed and engraved by Khalid Ibrahim; performed in the browser on plucked strings with a durbaan groove.',
  authors: [{ name: 'Abdillahi Qarshe' }, { name: 'Khalid Ibrahim' }],
  other: {
    composer: 'Abdillahi Qarshe (1950s)',
    engraver: 'Khalid Ibrahim',
  },
};

const scoreDir = join(process.cwd(), 'public/scores/beerdilaacshe');
const score = JSON.parse(readFileSync(join(scoreDir, 'notes.json'), 'utf8')) as ScoreData;

const kb = (file: string): string =>
  `${Math.max(1, Math.round(statSync(join(scoreDir, file)).size / 1024))} KB`;

const DOWNLOADS = [
  {
    file: 'Beerdilaacshe.pdf',
    label: 'Sheet music (PDF)',
    detail: `engraved score · ${kb('Beerdilaacshe.pdf')}`,
  },
  {
    file: 'Beerdilaacshe.midi',
    label: 'MIDI',
    detail: `melody data · ${kb('Beerdilaacshe.midi')}`,
  },
  {
    file: 'Beerdilaacshe.ly',
    label: 'LilyPond source',
    detail: `engraving source · ${kb('Beerdilaacshe.ly')}`,
  },
] as const;

export default function BeerdilaacshePage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-page font-body text-hi">
      <SiteHeader active="Scores" />
      <main className="mx-auto w-full max-w-4xl px-6 pt-10 pb-24">
        {/* ── Title ─────────────────────────────────────────────────────────── */}
        <header>
          <p className="numeric text-xs tracking-[0.24em] text-accent-state uppercase">
            From the qaraami songbook
          </p>
          <h1 className="mt-3 font-display text-4xl text-hi sm:text-5xl">Beerdilaacshe</h1>
          <p className="mt-2 font-display text-xl text-mid italic">A Qaraami melody</p>
        </header>

        {/* ── Credits ───────────────────────────────────────────────────────── */}
        <section aria-label="Credits" className="mt-8 max-w-2xl">
          <p className="text-base text-hi">
            Melody composed by <strong className="font-semibold">Abdillahi Qarshe</strong>, 1950s.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-mid">
            Abdillahi Qarshe was a pioneer of modern Somali music — among the first to set Somali
            song to the kaban (oud), and a founding voice of the qaraami tradition this archive
            exists to preserve. Beerdilaacshe comes from his body of work in the 1950s.
          </p>
          <p className="mt-4 text-sm text-mid">
            Sheet music transcribed and engraved by{' '}
            <strong className="font-semibold text-hi">Khalid Ibrahim</strong>.
          </p>
        </section>

        {/* ── The performance ───────────────────────────────────────────────── */}
        <section aria-label="Play the melody" className="mt-10">
          <h2 className="numeric mb-3 text-xs tracking-[0.24em] text-low uppercase">
            Hear the melody
          </h2>
          <ScorePlayer data={score} />
          <p className="mt-2 text-xs leading-relaxed text-low">
            Performed in the browser: the melody on plucked-string synthesis voiced after the oud —
            doubled courses, slightly detuned — over a durbaan frame-drum groove in{' '}
            {score.timeSignature}. No piano patch involved.
          </p>
        </section>

        {/* ── The engraving ─────────────────────────────────────────────────── */}
        <section aria-label="Sheet music" className="mt-12">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="numeric text-xs tracking-[0.24em] text-low uppercase">The engraving</h2>
            <a
              href="/scores/beerdilaacshe/Beerdilaacshe.pdf"
              download
              className="rounded-[4px] border border-hairline px-3 py-1.5 text-xs text-mid transition-colors hover:border-accent-state hover:text-hi focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
            >
              Download PDF
            </a>
          </div>
          <object
            data="/scores/beerdilaacshe/Beerdilaacshe.pdf"
            type="application/pdf"
            aria-label="Beerdilaacshe sheet music, one page"
            className="h-[75vh] min-h-[480px] w-full rounded-[2px] bg-paper ring-1 ring-paper-edge"
          >
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <p className="text-sm text-mid">
                This browser doesn’t display PDFs inline — the engraving is one page.
              </p>
              <a
                href="/scores/beerdilaacshe/Beerdilaacshe.pdf"
                download
                className="rounded-[4px] border border-hairline px-4 py-2 text-sm text-hi transition-colors hover:border-accent-state focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
              >
                Download the PDF
              </a>
            </div>
          </object>
        </section>

        {/* ── Downloads ─────────────────────────────────────────────────────── */}
        <section aria-label="Downloads" className="mt-12">
          <h2 className="numeric mb-3 text-xs tracking-[0.24em] text-low uppercase">Files</h2>
          <ul className="flex flex-col gap-2">
            {DOWNLOADS.map((d) => (
              <li key={d.file}>
                <a
                  href={`/scores/beerdilaacshe/${d.file}`}
                  download
                  className="group flex items-center justify-between rounded-[4px] border border-hairline bg-chrome-1 px-5 py-3.5 transition-colors hover:border-accent-state focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
                >
                  <span className="text-sm text-hi">{d.label}</span>
                  <span className="numeric text-xs text-low transition-colors group-hover:text-accent-state">
                    {d.detail}
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-low">
            “Beerdilaacshe” — melody by Abdillahi Qarshe (1950s) · sheet music by Khalid Ibrahim ·
            QaraamiGenAI archive edition.
          </p>
        </section>
      </main>
    </div>
  );
}
