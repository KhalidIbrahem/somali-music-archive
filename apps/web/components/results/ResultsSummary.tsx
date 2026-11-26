/**
 * ResultsSummary (/results, portfolio-v1): the evaluation in one figure and one
 * table. Figure: held-out improvement of each scaled adapter with its bootstrap
 * 95 % interval. Table: the transcription pool by source. Server component.
 *
 * Every number comes from lib/results-summary.json
 * (apps/ai-service/scripts/results_summary_build.py) and
 * lib/transcription-showcase.json (transcription_showcase_build.py).
 * The three adapters in the figure were trained on research-only archive
 * recordings: their numbers are published, their audio is not.
 */

import Link from 'next/link';
import results from '@/lib/results-summary.json';
import showcase from '@/lib/transcription-showcase.json';

interface Sitting {
  readonly date: string;
  readonly n: number;
  readonly adapter: number;
  readonly base: number;
  readonly none: number;
}
interface ScalingRow {
  readonly key: string;
  readonly label: string;
  readonly testSongs: number;
  readonly testClips: number;
  readonly baseCe: number;
  readonly adapterCe: number;
  readonly improvement: number;
  readonly ci95: readonly number[];
  readonly voicedBase: number;
  readonly voicedAdapter: number;
  readonly pcsBase: number;
  readonly pcsAdapter: number;
  readonly abPairs: number;
  readonly sittings: readonly Sitting[];
}
interface F1 {
  readonly mean: number;
  readonly ci95: readonly number[];
}
interface Results {
  readonly scaling: readonly ScalingRow[];
  readonly qormada: { readonly system: F1; readonly human: F1; readonly shareOfHuman: number };
  readonly restoration: {
    readonly bandSnrRawTrained: number;
    readonly bandSnrRestoredTrained: number;
  };
}
interface SourceStats {
  readonly recordings: number;
  readonly sourceHours: number;
  readonly pcs: { readonly median: number; readonly q1: number; readonly q3: number };
  readonly markedPercent: { readonly median: number };
  readonly tonicAmbiguous: number;
}

const DATA: Results = results;
const POOL = showcase.pool;
const SOURCES: ReadonlyArray<{ readonly name: string; readonly s: SourceStats }> = [
  { name: 'Solo oud (kaban)', s: POOL.bySource.oud },
  { name: 'Band with voice', s: POOL.bySource.band },
];

const pct = (x: number): string => `${Math.round(x * 100)} %`;

/** Improvement in held-out cross-entropy per adapter, with its 95 % interval. */
function ScalingFigure(): React.JSX.Element {
  const rows = DATA.scaling;
  const W = 640;
  const ROW = 46;
  const LEFT = 210;
  const RIGHT = 150;
  const TOP = 12;
  const H = TOP + rows.length * ROW + 34;
  const MAX = 0.16;
  const x = (v: number): number => LEFT + (v / MAX) * (W - LEFT - RIGHT);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Improvement in held-out cross-entropy for three adapters, with 95 percent intervals. All three intervals are above zero. The table below gives the same numbers."
      className="mt-5 w-full text-ink-tertiary"
    >
      {[0, 0.04, 0.08, 0.12, 0.16].map((t) => (
        <g key={t}>
          <line
            x1={x(t)}
            x2={x(t)}
            y1={TOP}
            y2={H - 30}
            stroke="currentColor"
            strokeWidth={t === 0 ? 1.5 : 0.5}
            opacity={t === 0 ? 0.9 : 0.4}
          />
          <text
            x={x(t)}
            y={H - 12}
            textAnchor="middle"
            fontSize="11"
            className="fill-ink-secondary"
          >
            {t === 0 ? 'no change' : `+${t.toFixed(2)}`}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const y = TOP + i * ROW + ROW / 2;
        const [lo, hi] = [r.ci95[0] ?? r.improvement, r.ci95[1] ?? r.improvement];
        return (
          <g key={r.key}>
            <title>
              {`${r.label}: +${r.improvement.toFixed(3)} nats, 95 % interval ${lo.toFixed(3)} to ${hi.toFixed(3)}, ${r.testSongs} unseen songs`}
            </title>
            <rect x="0" y={y - ROW / 2} width={W} height={ROW} fill="transparent" />
            <text
              x={LEFT - 14}
              y={y - 2}
              textAnchor="end"
              fontSize="12"
              className="fill-ink-primary"
            >
              {r.label}
            </text>
            <text
              x={LEFT - 14}
              y={y + 13}
              textAnchor="end"
              fontSize="10.5"
              className="fill-ink-secondary"
            >
              {r.testSongs} unseen songs
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
              <circle cx={x(r.improvement)} cy={y} r="5" fill="currentColor" />
            </g>
            <text x={W - RIGHT + 14} y={y + 4} fontSize="12" className="fill-ink-primary">
              +{r.improvement.toFixed(3)} [{lo.toFixed(3)}, {hi.toFixed(3)}]
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function sittingsText(s: readonly Sitting[]): string {
  if (s.length === 0) return 'not sat';
  return s.map((t) => `${t.adapter} / ${t.base} / ${t.none}`).join(', then ');
}

export function ResultsSummary(): React.JSX.Element {
  const q = DATA.qormada;
  const large = DATA.scaling.find((r) => r.key === 'large');
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6">
      <p className="font-body text-sm tracking-[0.3em] text-amber uppercase">Evaluation</p>
      <h1 className="mt-2 font-display text-3xl text-ink-primary sm:text-4xl">
        What was measured, in one figure and one table
      </h1>
      <p className="mt-3 max-w-2xl font-body text-ink-secondary">
        Two questions. Does fine-tuning a music model on Somali recordings make it predict unseen
        Somali songs better? And how well does the transcription pipeline hold to the scale of what
        it hears? Every number here is computed by a script from the run files in the repository.
      </p>

      <section aria-labelledby="gen-title" className="mt-12">
        <h2 id="gen-title" className="font-display text-2xl text-ink-primary">
          1. Generation: every fine-tuned model beats its base on unseen songs
        </h2>
        <p className="mt-3 max-w-2xl font-body text-ink-secondary">
          Each dot is how much better the fine-tuned model predicts songs it never saw in training,
          compared with the same model as published (cross-entropy, in nats; further right is
          better). The bar is the 95 % interval from resampling the test songs. No bar touches
          &ldquo;no change&rdquo;.
        </p>
        <ScalingFigure />

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left font-body text-sm text-ink-secondary">
            <thead>
              <tr className="border-b border-line-primary text-xs text-ink-secondary uppercase">
                <th className="py-2 pr-3 font-normal">Model</th>
                <th className="py-2 pr-3 font-normal">Loss, base → tuned</th>
                <th className="py-2 pr-3 font-normal">Melody in output</th>
                <th className="py-2 pr-3 font-normal">On-scale (PCS)</th>
                <th className="py-2 font-normal">Blind test: tuned / base / neither</th>
              </tr>
            </thead>
            <tbody>
              {DATA.scaling.map((r) => (
                <tr key={r.key} className="border-b border-line-secondary align-top">
                  <td className="py-2 pr-3 text-ink-primary">{r.label}</td>
                  <td className="py-2 pr-3">
                    {r.baseCe.toFixed(3)} → {r.adapterCe.toFixed(3)}
                  </td>
                  <td className="py-2 pr-3">
                    {pct(r.voicedBase)} → {pct(r.voicedAdapter)}
                  </td>
                  <td className="py-2 pr-3">
                    {r.pcsBase.toFixed(2)} → {r.pcsAdapter.toFixed(2)}
                  </td>
                  <td className="py-2">{sittingsText(r.sittings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="mt-6 font-display text-lg text-ink-primary">How to read it honestly</h3>
        <ul className="mt-2 flex max-w-2xl list-disc flex-col gap-2 pl-5 font-body text-ink-secondary">
          <li>
            The gain is real and it grows with model size: the larger model gains more than the
            medium one on the same {large?.testSongs ?? 27} test songs.
          </li>
          <li>
            The fine-tuned models put more trackable melody into what they generate, and drift
            further from the five-note scale while doing it.
          </li>
          <li>
            The ear is a harder judge than the loss. In blind paired tests of {large?.abPairs ?? 16}{' '}
            clips each, one listener (the author) mostly answered &ldquo;neither&rdquo;. Only the
            large model was preferred clearly, and only in its first sitting. A study with Somali
            musicians is open on the{' '}
            <Link href="/study" className="text-amber underline underline-offset-4">
              study page
            </Link>
            .
          </li>
          <li>
            These three models learned from archive cassettes that are not cleared for release, so
            their audio is not on this site. The clips on the Listen page come from models trained
            only on consented recordings.
          </li>
        </ul>
      </section>

      <section aria-labelledby="tr-title" className="mt-14">
        <h2 id="tr-title" className="font-display text-2xl text-ink-primary">
          2. Transcription: {POOL.recordings} recordings written out automatically
        </h2>
        <p className="mt-3 max-w-2xl font-body text-ink-secondary">
          The pipeline transcribed every recording in the pool without a failure. PCS is the share
          of the melody that lands on the recording&apos;s own five-note scale; notes off the scale
          are kept in the score and marked, not deleted.
        </p>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left font-body text-sm text-ink-secondary">
            <thead>
              <tr className="border-b border-line-primary text-xs text-ink-secondary uppercase">
                <th className="py-2 pr-3 font-normal">Source</th>
                <th className="py-2 pr-3 font-normal">Recordings</th>
                <th className="py-2 pr-3 font-normal">Audio</th>
                <th className="py-2 pr-3 font-normal">PCS, median (middle half)</th>
                <th className="py-2 pr-3 font-normal">Notes off the scale</th>
                <th className="py-2 font-normal">Tonic unclear</th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map(({ name, s }) => (
                <tr key={name} className="border-b border-line-secondary">
                  <td className="py-2 pr-3 text-ink-primary">{name}</td>
                  <td className="py-2 pr-3">{s.recordings}</td>
                  <td className="py-2 pr-3">{s.sourceHours.toFixed(1)} h</td>
                  <td className="py-2 pr-3">
                    <span className="text-ink-primary">{s.pcs.median.toFixed(2)}</span> (
                    {s.pcs.q1.toFixed(2)} to {s.pcs.q3.toFixed(2)})
                  </td>
                  <td className="py-2 pr-3">{Math.round(s.markedPercent.median)} %</td>
                  <td className="py-2">
                    {s.tonicAmbiguous} of {s.recordings}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-5 flex max-w-2xl list-disc flex-col gap-2 pl-5 font-body text-ink-secondary">
          <li>
            Solo oud transcribes cleanly. Voice over a band is harder: the voice has to be separated
            first, and singers slide between notes.
          </li>
          <li>
            No Somali recording has been corrected by ear yet, so these are properties of the
            automatic scores. On a public benchmark of sung melody with human annotations
            (vocadito), the browser transcriber scores a note F1 of {q.system.mean.toFixed(2)} [
            {q.system.ci95[0]?.toFixed(2)}, {q.system.ci95[1]?.toFixed(2)}]. Two human annotators
            agree with each other at {q.human.mean.toFixed(2)}, so the system reaches{' '}
            {Math.round(q.shareOfHuman * 100)} % of human agreement.
          </li>
          <li>
            Cassette restoration, measured on generated clips: a model trained on restored tapes
            produces audio with a band signal-to-noise ratio of{' '}
            {DATA.restoration.bandSnrRestoredTrained.toFixed(1)} dB, against{' '}
            {DATA.restoration.bandSnrRawTrained.toFixed(1)} dB for one trained on the raw tapes.
          </li>
        </ul>
        <p className="mt-5 font-body text-ink-secondary">
          <Link href="/scores" className="text-amber underline underline-offset-4">
            See three of the scores and the tuning findings
          </Link>
        </p>
      </section>
    </main>
  );
}
