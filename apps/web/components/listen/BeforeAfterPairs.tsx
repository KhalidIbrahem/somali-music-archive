'use client';

/**
 * BeforeAfterPairs — the top section of /listen (portfolio-v1): the same prompt
 * and seed through the published base model and through the project's adapter,
 * side by side, with one line on what to listen for and the scorer's numbers
 * for both sides. Pairs and numbers come from lib/listen-pairs.json, written by
 * apps/ai-service/scripts/listen_pairs_build.py; nothing here is typed by hand.
 * These clips are not the /study stimuli. Releasable models only (build gate).
 * The restoration slot stays a labelled placeholder until a rights-clear
 * recording exists: every restored pair on record is archival cassette audio.
 */

import listenPairs from '@/lib/listen-pairs.json';
import { usePlayer, type PlayerTrack } from '@/components/player/PlayerProvider';

interface PairSide {
  readonly file: string;
  readonly label: string;
  readonly pcs: number;
  readonly voiced: number;
  readonly flatness: number;
}

interface ListenPair {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly seed: number;
  readonly durationSec: number;
  readonly listenFor: string;
  readonly base: PairSide;
  readonly tuned: PairSide;
}

interface ListenPairs {
  readonly selectionNote: string;
  readonly pairs: readonly ListenPair[];
  readonly restoration: { readonly title: string; readonly note: string };
}

const DATA: ListenPairs = listenPairs;
const OUTPUT_LINE = 'AI model output — generated, not a recording';

function pct(x: number): string {
  return `${Math.round(x * 100)} %`;
}

function track(pair: ListenPair, side: 'base' | 'tuned'): PlayerTrack {
  const s = pair[side];
  return {
    id: `${pair.id}-${side}`,
    title: `${pair.title} · ${side === 'base' ? 'base model' : 'fine-tuned'}`,
    performer: s.label,
    src: s.file,
    durationSec: pair.durationSec,
    rightsLine: OUTPUT_LINE,
  };
}

function SideButton({
  pair,
  side,
}: {
  readonly pair: ListenPair;
  readonly side: 'base' | 'tuned';
}): React.JSX.Element {
  const player = usePlayer();
  const t = track(pair, side);
  const s = pair[side];
  const isActive = player.track?.id === t.id;
  const playing = isActive && (player.status === 'playing' || player.status === 'loading');
  const name = side === 'base' ? 'Base model' : 'Fine-tuned';
  return (
    <div
      className={`rounded-[4px] border p-3 ${isActive ? 'border-accent-live bg-chrome-2' : 'border-hairline bg-chrome-1'}`}
    >
      <button
        type="button"
        aria-label={playing ? `Pause ${t.title}` : `Play ${t.title}`}
        onClick={() => (isActive ? player.toggle() : player.play([t], 0))}
        className="flex min-h-11 w-full items-center gap-3 text-left focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
      >
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] border border-hairline ${isActive ? 'text-accent-live' : 'text-mid'}`}
        >
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
              <rect x="2" y="1.5" width="3" height="9" />
              <rect x="7" y="1.5" width="3" height="9" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
              <path d="M2.5 1.2v9.6L11 6 2.5 1.2Z" />
            </svg>
          )}
        </span>
        <span className="min-w-0">
          <span className="block text-sm text-hi">{name}</span>
          <span className="block truncate text-[11px] text-low">{s.label}</span>
        </span>
      </button>
      <dl className="numeric mt-2 grid grid-cols-3 gap-2 text-[11px] text-mid">
        <div>
          <dt className="tracking-[0.12em] text-low uppercase">Melody</dt>
          <dd className="text-hi">{pct(s.voiced)}</dd>
        </div>
        <div>
          <dt className="tracking-[0.12em] text-low uppercase">PCS</dt>
          <dd className="text-hi">{s.pcs.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="tracking-[0.12em] text-low uppercase">Noise</dt>
          <dd className="text-hi">{s.flatness.toFixed(3)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function BeforeAfterPairs(): React.JSX.Element | null {
  // No pairs: the clips are held until they have been listened to and approved (apps/web/held).
  if (DATA.pairs.length === 0) return null;
  return (
    <section id="pairs" aria-labelledby="pairs-title" className="mb-12 scroll-mt-24">
      <p className="numeric text-xs tracking-[0.24em] text-accent-state uppercase">
        Before and after
      </p>
      <h2 id="pairs-title" className="mt-3 font-display text-2xl text-hi sm:text-3xl">
        Same prompt, same seed: base model, then fine-tuned
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-mid">
        Each pair is one text prompt and one random seed run twice: once through MusicGen as
        published, once through the same model with this project&apos;s oud adapter. Play the base
        first. Every clip is {DATA.pairs[0]?.durationSec ?? 15} seconds of AI output.
      </p>
      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-low">
        Selection: {DATA.selectionNote}
      </p>

      <ol className="mt-6 flex flex-col gap-5">
        {DATA.pairs.map((pair, i) => (
          <li key={pair.id} className="rounded-[4px] border border-hairline p-4 sm:p-5">
            <h3 className="font-display text-lg text-hi">
              {i + 1}. {pair.title}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-hi">
              <span className="text-accent-state">Listen for: </span>
              {pair.listenFor}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <SideButton pair={pair} side="base" />
              <SideButton pair={pair} side="tuned" />
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-low">
              Prompt: {pair.prompt} · seed {pair.seed}
            </p>
          </li>
        ))}
      </ol>

      <p className="mt-4 max-w-2xl text-[12px] leading-relaxed text-low">
        Melody: share of the clip where a pitch tracker finds a clear note. PCS: share of those
        notes that sit on the clip&apos;s five-note scale. Noise: spectral flatness, lower is
        cleaner (real oud recordings measure about 0.002).
      </p>

      <div className="mt-6 rounded-[4px] border border-dashed border-hairline bg-chrome-1 px-5 py-4">
        <h3 className="font-display text-base text-hi">{DATA.restoration.title}</h3>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mid">
          {DATA.restoration.note}
        </p>
      </div>
    </section>
  );
}
