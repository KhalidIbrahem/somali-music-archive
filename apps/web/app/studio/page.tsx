/**
 * QaraamiGen Studio — landing (/studio). A dedicated product page for the
 * transcription engine: hero, live-stats strip, how-it-works, instrument
 * gallery. Server component; all interactivity lives in the client layout
 * (theme) and the /studio/transcribe tool.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'QaraamiGen Studio — AI Music Transcription for Somali Music',
  description:
    'Convert Somali music recordings into professional sheet music — voice, kaban, violin, or flute. Microtone-aware, beat-tracked, export to MusicXML, MIDI, and SVG.',
};

const STATS = [
  { value: '10 ms', label: 'pitch resolution on the vocal line' },
  { value: '2 staves', label: 'voice + kaban arrangements' },
  { value: '±cents', label: 'microtones preserved, marked in red' },
  { value: '3 formats', label: 'MusicXML · MIDI · SVG' },
] as const;

const STEPS = [
  {
    n: '01',
    title: 'Upload a recording',
    body: 'A cassette digitisation, a phone capture, a studio take — wav, mp3, m4a, flac, or ogg up to 50 MB.',
  },
  {
    n: '02',
    title: 'Choose the instrument',
    body: 'Voice, kaban, violin, flute — or the full arrangement. The engine separates the sources and listens only to what you chose.',
  },
  {
    n: '03',
    title: 'Read, play, export',
    body: 'An engraved score with key and tempo, side-by-side playback against the original, and downloads for MuseScore or any notation app.',
  },
] as const;

const INSTRUMENTS = [
  {
    so: 'Codka',
    en: 'Voice',
    body: 'The sung melody, tracked at 10 ms resolution — melisma and ornaments survive.',
  },
  {
    so: 'Kaban',
    en: 'Oud',
    body: 'The heart of qaraami, isolated from the band with its own register prior.',
  },
  { so: 'Fiyooliin', en: 'Violin', body: 'String lead lines from the golden-age orchestras.' },
  { so: 'Biibiile', en: 'Flute', body: 'Wind melodies, transcribed in their own range.' },
] as const;

/** Decorative floating notation, drawn inline so both themes tint it. */
function FloatingNotes(): React.JSX.Element {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg
        className="qg-float-slow absolute -right-10 top-8 opacity-25"
        width="380"
        height="380"
        viewBox="0 0 100 100"
        fill="none"
      >
        <path
          d="M18 78c22 8 42-2 46-20S82 28 96 30"
          stroke="var(--qg-accent)"
          strokeWidth="0.8"
          strokeLinecap="round"
        />
        <circle cx="30" cy="70" r="4" fill="var(--qg-accent)" />
        <path
          d="M34 70V46l10 4"
          stroke="var(--qg-accent)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <circle cx="62" cy="52" r="3.4" fill="var(--qg-amber)" />
        <path d="M65.4 52V32" stroke="var(--qg-amber)" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <svg
        className="qg-float absolute left-4 bottom-6 opacity-20"
        width="220"
        height="220"
        viewBox="0 0 100 100"
        fill="none"
      >
        <path
          d="M10 30c18-10 40-6 52 8s26 18 34 14"
          stroke="var(--qg-accent)"
          strokeWidth="0.8"
          strokeLinecap="round"
        />
        <circle cx="46" cy="60" r="4" fill="var(--qg-accent)" />
        <path
          d="M50 60V38h12v18"
          stroke="var(--qg-accent)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <circle cx="66" cy="56" r="4" fill="var(--qg-accent)" />
      </svg>
    </div>
  );
}

export default function StudioLanding(): React.JSX.Element {
  return (
    <main>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-[var(--qg-line)] bg-[var(--qg-bg)]">
        <FloatingNotes />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-6 py-24 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="font-body text-sm uppercase tracking-[0.3em] text-[var(--qg-accent)]">
              Qoraalka muusikada
            </p>
            <h1 className="mt-3 font-display text-5xl leading-tight text-[var(--qg-ink)] sm:text-6xl">
              AI Music Transcription
              <span className="block text-[var(--qg-accent)]">for Somali Music</span>
            </h1>
            <p className="mt-6 max-w-xl font-body text-lg leading-relaxed text-[var(--qg-ink2)]">
              Convert recordings into professional sheet music — the sung line, the kaban, violin,
              or flute. Built on the Somali Music Archive&apos;s research: pentatonic-aware,
              beat-tracked through rubato, and honest about microtones — inflections are{' '}
              <span className="text-[var(--qg-amber)]">preserved and marked</span>, never
              &ldquo;corrected&rdquo; to a Western grid.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/studio/transcribe"
                className="rounded-xl bg-[var(--qg-accent)] px-7 py-3.5 font-body text-base font-bold text-[var(--qg-bg)] transition-transform hover:-translate-y-0.5"
              >
                Transcribe a recording
              </Link>
              <a
                href="#how"
                className="rounded-xl border border-[var(--qg-line)] px-7 py-3.5 font-body text-base text-[var(--qg-ink2)] transition-colors hover:border-[var(--qg-accent)] hover:text-[var(--qg-accent)]"
              >
                How does it work?
              </a>
            </div>
          </div>

          {/* mock score card */}
          <div className="relative">
            <div className="rounded-2xl border border-[var(--qg-line)] bg-[var(--qg-panel)] p-6 shadow-2xl">
              <div className="flex items-center justify-between">
                <p className="font-display text-lg text-[var(--qg-ink)]">Qaraami — A major</p>
                <span className="rounded-full border border-[var(--qg-accent)]/40 px-3 py-1 font-body text-xs uppercase tracking-wider text-[var(--qg-accent)]">
                  Voice + Kaban
                </span>
              </div>
              <div className="mt-4 rounded-lg bg-[var(--qg-score-bg)] p-4">
                <svg viewBox="0 0 320 96" className="w-full" aria-hidden>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <line
                      key={i}
                      x1="8"
                      x2="312"
                      y1={14 + i * 8}
                      y2={14 + i * 8}
                      stroke="#20242a"
                      strokeWidth="0.8"
                    />
                  ))}
                  {[0, 1, 2, 3, 4].map((i) => (
                    <line
                      key={`b${i}`}
                      x1="8"
                      x2="312"
                      y1={60 + i * 7}
                      y2={60 + i * 7}
                      stroke="#20242a"
                      strokeWidth="0.7"
                    />
                  ))}
                  {(
                    [
                      [40, 30],
                      [72, 22],
                      [104, 26],
                      [136, 18],
                      [168, 22],
                      [200, 30],
                      [232, 26],
                      [264, 22],
                    ] as ReadonlyArray<readonly [number, number]>
                  ).map(([x, y], i) => (
                    <g key={i}>
                      <ellipse
                        cx={x}
                        cy={y}
                        rx="5"
                        ry="3.6"
                        fill={i === 3 ? '#B03030' : '#20242a'}
                      />
                      <line
                        x1={x + 4.6}
                        y1={y - 1}
                        x2={x + 4.6}
                        y2={y - 22}
                        stroke={i === 3 ? '#B03030' : '#20242a'}
                        strokeWidth="1.4"
                      />
                    </g>
                  ))}
                  {(
                    [
                      [56, 74],
                      [120, 81],
                      [184, 74],
                      [248, 81],
                    ] as ReadonlyArray<readonly [number, number]>
                  ).map(([x, y], i) => (
                    <ellipse key={`o${i}`} cx={x} cy={y} rx="4.4" ry="3.2" fill="#5c5344" />
                  ))}
                </svg>
              </div>
              <p className="mt-3 font-body text-xs text-[var(--qg-ink3)]">
                Red notehead = a preserved microtonal inflection (&ldquo;~&rdquo;) — ornament, not
                error.
              </p>
            </div>
          </div>
        </div>

        {/* stats strip */}
        <div className="relative border-t border-[var(--qg-line)] bg-[var(--qg-bg2)]">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-6 py-8 sm:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.label}>
                <p className="font-display text-2xl text-[var(--qg-accent)]">{s.value}</p>
                <p className="mt-1 font-body text-xs text-[var(--qg-ink2)]">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="font-display text-3xl text-[var(--qg-ink)]">How it works</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="rounded-2xl border border-[var(--qg-line)] bg-[var(--qg-panel)] p-6"
            >
              <p className="font-display text-sm text-[var(--qg-accent)]">{s.n}</p>
              <h3 className="mt-2 font-display text-xl text-[var(--qg-ink)]">{s.title}</h3>
              <p className="mt-3 font-body text-sm leading-relaxed text-[var(--qg-ink2)]">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Instruments ──────────────────────────────────────────────────── */}
      <section className="border-t border-[var(--qg-line)] bg-[var(--qg-bg2)]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-display text-3xl text-[var(--qg-ink)]">More than the kaban</h2>
          <p className="mt-3 max-w-2xl font-body text-[var(--qg-ink2)]">
            Somali music lives across many voices. Choose what the engine should listen to — it
            separates the sources first, then transcribes only your instrument in its own register.
          </p>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {INSTRUMENTS.map((i) => (
              <div
                key={i.en}
                className="rounded-2xl border border-[var(--qg-line)] bg-[var(--qg-panel)] p-6 transition-colors hover:border-[var(--qg-accent)]/60"
              >
                <p className="font-display text-xl text-[var(--qg-ink)]">{i.so}</p>
                <p className="font-body text-xs uppercase tracking-wider text-[var(--qg-accent)]">
                  {i.en}
                </p>
                <p className="mt-3 font-body text-sm leading-relaxed text-[var(--qg-ink2)]">
                  {i.body}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-10">
            <Link
              href="/studio/transcribe"
              className="inline-block rounded-xl bg-[var(--qg-accent)] px-7 py-3.5 font-body font-bold text-[var(--qg-bg)] transition-transform hover:-translate-y-0.5"
            >
              Start transcribing
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
