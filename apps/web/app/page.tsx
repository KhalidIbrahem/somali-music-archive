/**
 * Landing page (ARCHITECTURE.md §7 identity). Archival dignity meets modern
 * clarity — the genres are pulled from the shared @sma/constants source of truth
 * so the web copy can never list a genre the platform does not recognise.
 */

import { GENRE_DESCRIPTORS, GENRES } from '@sma/constants';

export default function Home(): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-10 px-6 py-24">
      <header className="flex flex-col gap-4">
        <p className="font-body text-sm uppercase tracking-widest text-amber">
          Somali Music AI Preservation Platform
        </p>
        <h1 className="font-display text-5xl leading-tight text-ink-primary">
          The music of our ancestors, for the children of tomorrow.
        </h1>
        <p className="max-w-xl font-body text-lg text-ink-secondary">
          The first structured, AI-annotated archive of Somali traditional music —
          preserved permanently, taught to a new generation, and opened to
          researchers worldwide.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-2xl text-ink-primary">The traditions</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {GENRES.filter((g) => g !== 'other').map((g) => (
            <li
              key={g}
              className="rounded-xl border border-line-secondary bg-bg-secondary p-4"
            >
              <p className="font-display text-lg text-amber">{GENRE_DESCRIPTORS[g].label}</p>
              <p className="font-body text-sm text-ink-secondary">
                {GENRE_DESCRIPTORS[g].description}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
