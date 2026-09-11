/**
 * PublicLibraryShelf (/library with NEXT_PUBLIC_REQUIRE_AUTH=false).
 *
 * The member shelf (LibraryShelf.tsx) uploads scanned songbooks to the API and
 * lists them for signed-in members. The public site has neither accounts nor
 * an API behind it, so the shelf shows the one engraved score that is cleared
 * for public use and says plainly that the scanned books are not public yet.
 * Server component.
 */

import Link from 'next/link';

export function PublicLibraryShelf(): React.JSX.Element {
  return (
    <main className="pb-24">
      <section className="relative overflow-hidden border-b border-line-secondary">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[46rem] rounded-full bg-amber/10 blur-3xl animate-glow-drift"
        />
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-5 px-6 py-20 text-center">
          <p className="font-body text-sm uppercase tracking-[0.3em] text-amber">Maktabadda</p>
          <h1 className="font-display text-5xl leading-tight text-ink-primary sm:text-6xl">
            The Library
          </h1>
          <p className="max-w-2xl font-body text-lg leading-relaxed text-ink-secondary">
            Somali music was written down far less often than it was sung. When a book of music
            sheets surfaces, a songbook, a notation collection, a teacher&apos;s manuscript, it
            belongs here, scanned and preserved beside the recordings it describes.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-14">
        <h2 className="mb-6 font-display text-2xl text-ink-primary">On the shelf</h2>
        <ul className="grid gap-5 sm:grid-cols-2">
          <li>
            <article className="flex h-full flex-col gap-3 rounded-2xl border border-line-secondary bg-bg-secondary p-6">
              <h3 className="font-display text-xl leading-snug text-ink-primary">Beerdilaacshe</h3>
              <p className="font-body text-sm text-ink-secondary">
                A qaraami melody by Abdillahi Qarshe, 1950s. Sheet music transcribed and engraved by
                Khalid Ibrahim: PDF, MIDI and the LilyPond source, with a performance of the melody
                in the browser.
              </p>
              <Link
                href="/scores/beerdilaacshe"
                className="mt-auto self-start rounded-lg border border-amber/40 px-4 py-2 font-body text-sm font-semibold text-amber transition-colors hover:bg-amber hover:text-bg-primary"
              >
                Open the score
              </Link>
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
