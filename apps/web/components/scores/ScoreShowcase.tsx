/**
 * ScoreShowcase (/scores, portfolio-v1): three automatic transcriptions, each
 * beside playback of its own notes, then what the tuning measurements show in
 * plain words. Server component; the MIDI player loads on the client.
 *
 * Audio: the recordings behind these scores are not rights-cleared, so none is
 * served. "Play" renders the written notes (MIDI), and the page says so. A
 * recording goes beside its score only after its consent record is on file.
 *
 * Every number comes from lib/transcription-showcase.json
 * (apps/ai-service/scripts/transcription_showcase_build.py) or from the score
 * entries in lib/demoExamples.ts.
 */

import Image from 'next/image';
import Link from 'next/link';
import showcase from '@/lib/transcription-showcase.json';
import { TRANSCRIPTION_EXAMPLES, formatClock, type TranscriptionExample } from '@/lib/demoExamples';
import { MidiPlay } from '@/components/transcribe/MidiPlay';

interface Stats {
  readonly n: number;
  readonly mean: number;
  readonly sd: number;
  readonly median: number;
}
interface IntervalRow extends Stats {
  readonly interval: number;
  readonly se: number;
  readonly bySource: { readonly band?: Stats; readonly oud?: Stats };
}
interface Showcase {
  readonly scores: Readonly<Record<string, { readonly pcs: number }>>;
  readonly pool: {
    readonly recordings: number;
    readonly bySource: {
      readonly oud: { readonly recordings: number; readonly pcs: Stats };
      readonly band: { readonly recordings: number; readonly pcs: Stats };
    };
    readonly intervals: readonly IntervalRow[];
  };
}

const DATA: Showcase = showcase;
const POOL = DATA.pool;

const INTERVAL_NAME: Readonly<Record<number, string>> = {
  200: 'second',
  300: 'minor third',
  400: 'major third',
  500: 'fourth',
  700: 'fifth',
  800: 'minor sixth',
  900: 'sixth',
  1000: 'minor seventh',
};

function signed(x: number): string {
  return `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}`;
}

function row(interval: number): IntervalRow {
  const r = POOL.intervals.find((i) => i.interval === interval);
  if (!r) throw new Error(`no interval ${interval} in transcription-showcase.json`);
  return r;
}

/** The five fitted degrees of one score against the nearest equal-tempered steps. */
function ScaleStrip({ cents }: { readonly cents: readonly number[] }): React.JSX.Element {
  const W = 320;
  const x = (c: number): number => 10 + (c / 1200) * (W - 20);
  return (
    <svg
      viewBox={`0 0 ${W} 46`}
      role="img"
      aria-label={`Fitted scale in cents above the tonic: ${cents.join(', ')}`}
      className="mt-3 w-full max-w-sm text-ink-tertiary"
    >
      <line x1={x(0)} x2={x(1200)} y1="18" y2="18" stroke="currentColor" strokeWidth="1" />
      {Array.from({ length: 13 }, (_, i) => (
        <line
          key={i}
          x1={x(i * 100)}
          x2={x(i * 100)}
          y1="13"
          y2="23"
          stroke="currentColor"
          strokeWidth="1"
        />
      ))}
      {cents.map((c) => (
        <g key={c} className="text-amber">
          <circle cx={x(c)} cy="18" r="5" fill="currentColor" />
          <text
            x={x(c)}
            y="40"
            textAnchor="middle"
            fontSize="10"
            className="fill-ink-secondary font-body"
          >
            {Math.round(c)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Stat({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): React.JSX.Element {
  return (
    <div className="rounded-xl border border-line-secondary bg-bg-tertiary px-3 py-2">
      <p className="font-body text-[11px] tracking-wider text-ink-tertiary uppercase">{label}</p>
      <p className="mt-0.5 font-display text-base text-amber">{value}</p>
    </div>
  );
}

function ScoreCard({ ex }: { readonly ex: TranscriptionExample }): React.JSX.Element {
  const pcs = DATA.scores[ex.slug]?.pcs;
  const onScale = ex.notes - ex.marked;
  return (
    <li className="grid gap-6 rounded-2xl border border-line-secondary bg-bg-secondary p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <a
        href={ex.pdf}
        target="_blank"
        rel="noreferrer"
        aria-label={`${ex.title}: open the full score as a PDF`}
        className="block self-start overflow-hidden rounded-lg bg-bg-inverse ring-1 ring-line-primary"
      >
        <Image
          src={ex.preview.src}
          alt={`First page of the ${ex.title} score`}
          width={ex.preview.width}
          height={ex.preview.height}
          sizes="(min-width: 1024px) 480px, 100vw"
          className="h-auto w-full"
        />
      </a>
      <div className="min-w-0">
        <h2 className="font-display text-2xl text-ink-primary">{ex.title}</h2>
        <p className="mt-1 font-body text-sm text-ink-secondary">
          {ex.source} · {formatClock(ex.durationSec)} · {ex.staves.join(' and ')}
        </p>

        <div className="mt-4">
          <p className="font-body text-xs tracking-wider text-ink-tertiary uppercase">
            Hear the written notes
          </p>
          <div className="mt-2">
            <MidiPlay src={ex.midi} />
          </div>
          <p className="mt-2 font-body text-xs text-ink-secondary">
            This plays the transcription itself on a piano sound, not the recording. The recording
            is not published: its consent record is not on file yet.
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {pcs !== undefined && <Stat label="PCS" value={pcs.toFixed(2)} />}
          <Stat label="Tonic" value={ex.tonic} />
          <Stat label="Tempo" value={`${ex.bpm} BPM`} />
          <Stat label="Notes" value={`${ex.notes}`} />
        </div>

        <p className="mt-4 font-body text-sm text-ink-secondary">
          {onScale} of {ex.notes} notes sit on the five-note scale the pipeline measured from this
          recording.{' '}
          <span className="text-danger">
            The other {ex.marked} are kept in the score and marked
          </span>
          , because slides and ornaments are part of the music.
        </p>
        <ScaleStrip cents={ex.scaleCents} />
        <p className="mt-1 font-body text-xs text-ink-tertiary">
          The five scale notes in cents above the tonic. Tick marks are piano keys, 100 cents apart.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={ex.pdf}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-amber/40 px-4 py-2 font-body text-sm font-semibold text-amber transition-colors hover:bg-amber hover:text-bg-primary"
          >
            Full score (PDF)
          </a>
          <a
            href={ex.musicXml}
            download
            className="rounded-lg border border-line-primary px-4 py-2 font-body text-sm text-ink-secondary transition-colors hover:text-ink-primary"
          >
            MusicXML
          </a>
          <a
            href={ex.midi}
            download
            className="rounded-lg border border-line-primary px-4 py-2 font-body text-sm text-ink-secondary transition-colors hover:text-ink-primary"
          >
            MIDI
          </a>
        </div>
      </div>
    </li>
  );
}

/** Mean deviation from equal temperament per scale interval, with a ±2 standard-error bar. */
function TuningChart(): React.JSX.Element {
  const rows = POOL.intervals;
  const W = 640;
  const ROW = 34;
  const LEFT = 150;
  const RIGHT = 70;
  const TOP = 28;
  const H = TOP + rows.length * ROW + 30;
  const MAX = 30;
  const x = (c: number): number => LEFT + ((c + MAX) / (2 * MAX)) * (W - LEFT - RIGHT);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Mean deviation of each scale interval from equal temperament, in cents, with a two standard error bar. The table below gives the same numbers."
      className="mt-5 w-full text-ink-tertiary"
    >
      {[-20, -10, 0, 10, 20].map((t) => (
        <g key={t}>
          <line
            x1={x(t)}
            x2={x(t)}
            y1={TOP - 6}
            y2={H - 26}
            stroke="currentColor"
            strokeWidth={t === 0 ? 1.5 : 0.5}
            opacity={t === 0 ? 0.9 : 0.4}
          />
          <text
            x={x(t)}
            y={H - 10}
            textAnchor="middle"
            fontSize="11"
            className="fill-ink-tertiary font-body"
          >
            {t === 0 ? 'piano tuning' : `${t > 0 ? '+' : '−'}${Math.abs(t)}`}
          </text>
        </g>
      ))}
      <text x={x(-20)} y={12} textAnchor="middle" fontSize="11" className="fill-ink-tertiary">
        flatter
      </text>
      <text x={x(20)} y={12} textAnchor="middle" fontSize="11" className="fill-ink-tertiary">
        sharper
      </text>
      {rows.map((r, i) => {
        const y = TOP + i * ROW + ROW / 2;
        const lo = Math.max(-MAX, r.mean - 2 * r.se);
        const hi = Math.min(MAX, r.mean + 2 * r.se);
        return (
          <g key={r.interval}>
            <title>
              {`${INTERVAL_NAME[r.interval]} (${r.interval} cents): mean ${signed(r.mean)} cents, ±${(2 * r.se).toFixed(1)}, ${r.n} recordings`}
            </title>
            <rect x="0" y={y - ROW / 2} width={W} height={ROW} fill="transparent" />
            <text
              x={LEFT - 12}
              y={y + 4}
              textAnchor="end"
              fontSize="12"
              className="fill-ink-secondary"
            >
              {INTERVAL_NAME[r.interval]}
            </text>
            <g className="text-amber">
              <line
                x1={x(lo)}
                x2={x(hi)}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <circle cx={x(r.mean)} cy={y} r="5" fill="currentColor" />
            </g>
            <text x={W - RIGHT + 12} y={y + 4} fontSize="12" className="fill-ink-primary">
              {signed(r.mean)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function ScoreShowcase(): React.JSX.Element {
  const seventh = row(1000);
  const third = row(400);
  const minorThird = row(300);
  const fifth = row(700);
  const spreadLo = Math.min(...POOL.intervals.filter((i) => i.n >= 20).map((i) => i.sd));
  const spreadHi = Math.max(...POOL.intervals.filter((i) => i.n >= 20).map((i) => i.sd));
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6">
      <p className="font-body text-sm tracking-[0.3em] text-amber uppercase">Qormada</p>
      <h1 className="mt-2 font-display text-3xl text-ink-primary sm:text-4xl">
        Three transcriptions, and what the tuning shows
      </h1>
      <p className="mt-3 max-w-2xl font-body text-ink-secondary">
        Qaraami is taught by ear and has almost no written scores. This pipeline listens to a
        recording and writes the melody down: it tracks the pitch, measures which five notes the
        performer actually uses, and engraves the result. These three scores are its output,
        unedited. Nobody has corrected them by ear yet.
      </p>

      <ol className="mt-8 flex flex-col gap-8">
        {TRANSCRIPTION_EXAMPLES.map((ex) => (
          <ScoreCard key={ex.slug} ex={ex} />
        ))}
      </ol>

      <section aria-labelledby="pcs-title" className="mt-14 max-w-3xl">
        <h2 id="pcs-title" className="font-display text-2xl text-ink-primary">
          PCS: how much of the melody stays on the scale
        </h2>
        <p className="mt-3 font-body text-ink-secondary">
          The Pentatonic Conformity Score is the share of sung or played pitch that lands within
          half a piano key of one of the recording&apos;s own five scale notes. A score of 1.00
          means every note is on the scale. Over the {POOL.recordings} recordings transcribed so
          far, solo oud is clean and voice with a band is harder:
        </p>
        <div className="mt-4 grid max-w-md grid-cols-2 gap-3">
          <Stat
            label={`Solo oud · ${POOL.bySource.oud.recordings} recordings`}
            value={`${POOL.bySource.oud.pcs.median.toFixed(2)} median`}
          />
          <Stat
            label={`Band with voice · ${POOL.bySource.band.recordings} recordings`}
            value={`${POOL.bySource.band.pcs.median.toFixed(2)} median`}
          />
        </div>
      </section>

      <section aria-labelledby="tuning-title" className="mt-14 max-w-3xl">
        <h2 id="tuning-title" className="font-display text-2xl text-ink-primary">
          The scale is not tuned like a piano
        </h2>
        <p className="mt-3 font-body text-ink-secondary">
          A cent is one hundredth of the step between two neighbouring piano keys. For each
          recording the pipeline measures where its five scale notes really sit, then compares them
          with piano tuning. The dot is the average over the recordings that use that interval; the
          bar is the uncertainty of that average.
        </p>
        <TuningChart />
        <ul className="mt-5 flex list-disc flex-col gap-2 pl-5 font-body text-ink-secondary">
          <li>
            <span className="text-ink-primary">The minor seventh is played sharp.</span> On average{' '}
            {signed(seventh.mean)} cents over {seventh.n} recordings, and in the same direction on
            solo oud ({signed(seventh.bySource.oud?.mean ?? 0)}) and with a band (
            {signed(seventh.bySource.band?.mean ?? 0)}).
          </li>
          <li>
            <span className="text-ink-primary">The major third leans flat, less certainly.</span>{' '}
            {signed(third.mean)} cents on average over {third.n} recordings, but that comes from the
            band recordings ({signed(third.bySource.band?.mean ?? 0)}); the{' '}
            {third.bySource.oud?.n ?? 0} solo oud recordings that use it go the other way.
          </li>
          <li>
            <span className="text-ink-primary">On solo oud the minor third is raised.</span>{' '}
            {signed(minorThird.bySource.oud?.mean ?? 0)} cents over{' '}
            {minorThird.bySource.oud?.n ?? 0} recordings.
          </li>
          <li>
            <span className="text-ink-primary">The fifth is where a piano puts it.</span>{' '}
            {signed(fifth.mean)} cents over {fifth.n} recordings.
          </li>
        </ul>
        <p className="mt-4 font-body text-sm text-ink-secondary">
          How far to trust this: these are automatic measurements, not yet checked by a musician.
          Recordings differ from each other by {Math.round(spreadLo)} to {Math.round(spreadHi)}{' '}
          cents on every interval, so these are tendencies across performers, not a fixed tuning
          system. Tape speed is removed first, by measuring each recording&apos;s overall offset.
        </p>

        <details className="mt-5 font-body text-sm text-ink-secondary">
          <summary className="cursor-pointer text-ink-primary">The numbers as a table</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line-primary text-xs text-ink-tertiary uppercase">
                  <th className="py-2 pr-3 font-normal">Interval</th>
                  <th className="py-2 pr-3 font-normal">Recordings</th>
                  <th className="py-2 pr-3 font-normal">Mean, cents</th>
                  <th className="py-2 pr-3 font-normal">Spread (sd)</th>
                  <th className="py-2 pr-3 font-normal">Solo oud</th>
                  <th className="py-2 font-normal">Band</th>
                </tr>
              </thead>
              <tbody>
                {POOL.intervals.map((r) => (
                  <tr key={r.interval} className="border-b border-line-secondary">
                    <td className="py-2 pr-3">
                      {INTERVAL_NAME[r.interval]} ({r.interval})
                    </td>
                    <td className="py-2 pr-3">{r.n}</td>
                    <td className="py-2 pr-3 text-ink-primary">{signed(r.mean)}</td>
                    <td className="py-2 pr-3">{r.sd.toFixed(1)}</td>
                    <td className="py-2 pr-3">
                      {r.bySource.oud
                        ? `${signed(r.bySource.oud.mean)} (${r.bySource.oud.n})`
                        : '–'}
                    </td>
                    <td className="py-2">
                      {r.bySource.band
                        ? `${signed(r.bySource.band.mean)} (${r.bySource.band.n})`
                        : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <p className="mt-12 font-body text-ink-secondary">
        <Link href="/transcribe" className="text-amber underline underline-offset-4">
          Transcribe your own recording in the browser
        </Link>{' '}
        — upload a file or use the microphone, and download the score.
      </p>
    </main>
  );
}
