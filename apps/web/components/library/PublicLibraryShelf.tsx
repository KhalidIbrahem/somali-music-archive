/**
 * PublicLibraryShelf (/library on the public site) — the resources page
 * (website-v1). It lists only material that is rights-clear on the record in
 * docs/DATA_PROVENANCE.md: the Beerdilaacshe engraving (§2, Khalid's own
 * sheet music) with its downloads, and a pointer to the automatic
 * transcriptions already shown on Transcribe (pipeline output, no audio). The
 * "Somali music history book" slot is empty by design until Khalid uploads
 * it. The member shelf (LibraryShelf.tsx) is unchanged and stays behind the
 * invite-only flag. Server component.
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';
import Link from 'next/link';

const scoreDir = join(process.cwd(), 'public/scores/beerdilaacshe');
const kb = (file: string): string =>
  `${Math.max(1, Math.round(statSync(join(scoreDir, file)).size / 1024))} KB`;

const BEERDILAACSHE_FILES = [
  { file: 'Beerdilaacshe.pdf', label: 'Sheet music (PDF)' },
  { file: 'Beerdilaacshe.midi', label: 'MIDI' },
  { file: 'Beerdilaacshe.ly', label: 'LilyPond source' },
] as const;

export function PublicLibraryShelf(): React.JSX.Element {
  return (
    <main className="pb-24">
      <section className="relative overflow-hidden border-b border-line-secondary">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[46rem] rounded-full bg-amber/10 blur-3xl animate-glow-drift"
        />
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-5 px-4 py-16 text-center sm:px-6 sm:py-20">
          <p className="font-body text-sm uppercase tracking-[0.3em] text-amber">Maktabadda</p>
          <h1 className="font-display text-4xl leading-tight text-ink-primary sm:text-6xl">
            The Library
          </h1>
          <p className="max-w-2xl font-body text-lg leading-relaxed text-ink-secondary">
            Scores and resources for reading and playing Somali music. Everything on this shelf is
            rights-clear and stated as such; scanned books and manuscripts are added only after
            their rights are checked.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-14">
        <h2 className="mb-5 font-display text-2xl text-ink-primary">Scores</h2>
        <ul className="grid gap-5 sm:grid-cols-2">
          <li>
            <article className="flex h-full flex-col gap-3 rounded-2xl border border-line-secondary bg-bg-secondary p-6">
              <p className="font-body text-xs uppercase tracking-wider text-amber">
                Engraved score
              </p>
              <h3 className="font-display text-xl leading-snug text-ink-primary">Beerdilaacshe</h3>
              <p className="font-body text-sm text-ink-secondary">
                A qaraami melody by Abdillahi Qarshe, 1950s. Sheet music transcribed and engraved by
                Khalid Ibrahim, with a performance of the melody in the browser.
              </p>
              <ul className="mt-1 flex flex-col divide-y divide-line-secondary border-y border-line-secondary">
                {BEERDILAACSHE_FILES.map((d) => (
                  <li key={d.file}>
                    <a
                      href={`/scores/beerdilaacshe/${d.file}`}
                      download
                      className="flex min-h-11 items-center justify-between gap-3 font-body text-sm text-ink-primary transition-colors hover:text-amber"
                    >
                      <span>{d.label}</span>
                      <span className="font-mono text-xs text-ink-tertiary">{kb(d.file)}</span>
                    </a>
                  </li>
                ))}
              </ul>
              <Link
                href="/scores/beerdilaacshe"
                className="mt-auto self-start rounded-lg border border-amber/40 px-4 py-2 font-body text-sm font-semibold text-amber transition-colors hover:bg-amber hover:text-bg-primary"
              >
                Open the score
              </Link>
            </article>
          </li>
          <li>
            <article className="flex h-full flex-col gap-3 rounded-2xl border border-line-secondary bg-bg-secondary p-6">
              <p className="font-body text-xs uppercase tracking-wider text-amber">
                Automatic transcriptions
              </p>
              <h3 className="font-display text-xl leading-snug text-ink-primary">
                Three scores from the pipeline
              </h3>
              <p className="font-body text-sm text-ink-secondary">
                Two solo oud (kaban) pieces and a 30-second band excerpt, transcribed by the
                project&apos;s pipeline with the scale it detected in each recording. Notation only:
                no recording is included, and every note is marked automatic and unverified.
              </p>
              <Link
                href="/transcribe"
                className="mt-auto self-start rounded-lg border border-line-primary px-4 py-2 font-body text-sm text-ink-secondary transition-colors hover:text-ink-primary"
              >
                See the transcriptions
              </Link>
            </article>
          </li>
        </ul>
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-4 sm:px-6">
        <h2 className="mb-5 font-display text-2xl text-ink-primary">Books</h2>
        <ul className="grid gap-5 sm:grid-cols-2">
          <li>
            <article
              aria-label="Somali music history book, coming soon"
              className="flex h-full min-h-56 flex-col gap-3 rounded-2xl border border-dashed border-line-primary bg-bg-secondary/50 p-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-body text-xs uppercase tracking-wider text-ink-tertiary">Book</p>
                <span className="rounded-full border border-line-primary px-3 py-1 font-body text-[11px] uppercase tracking-wider text-ink-tertiary">
                  Coming soon
                </span>
              </div>
              <h3 className="font-display text-xl leading-snug text-ink-primary">
                Somali music history book
              </h3>
              <p className="font-body text-sm text-ink-tertiary">
                [[KHALID: one or two lines about the book — what it is, who wrote it, and when it
                will be on the shelf]]
              </p>
              <div
                aria-hidden
                className="mt-auto flex h-24 items-center justify-center rounded-lg border border-dashed border-line-secondary bg-bg-primary/40 font-body text-xs text-ink-tertiary"
              >
                Cover and download will appear here
              </div>
            </article>
          </li>
        </ul>
        <p className="mt-8 max-w-2xl font-body text-sm text-ink-secondary">
          Scanned songbooks and manuscripts are contributed by members of the project and checked
          for rights before they are shown. None is on the public shelf yet.
        </p>
      </section>
    </main>
  );
}
