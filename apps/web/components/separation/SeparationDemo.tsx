'use client';

/**
 * SeparationDemo — /separation (portfolio-v1): one mixture split into oud and
 * voice, and one noisy take restored, each clip beside its spectrogram and the
 * measured numbers. Everything comes from lib/dsp-demo.json, written by
 * apps/ai-service/scripts/portfolio_dsp_build.py from a run of
 * portfolio_dsp_demo.py; nothing here is typed by hand. The banner says whether
 * the audio is a recording or synthesised test signals.
 */

import dspDemo from '@/lib/dsp-demo.json';
import { usePlayer, type PlayerTrack } from '@/components/player/PlayerProvider';

interface Clip {
  readonly id: string;
  readonly label: string;
  readonly what: string;
  readonly file: string;
  readonly image: string;
}

interface Scores {
  readonly mixtureSiSdr: number;
  readonly separatedSiSdr: number;
}

interface DspDemo {
  readonly source: { readonly kind: string; readonly label: string; readonly note: string };
  readonly seconds: number;
  readonly separation: {
    readonly method: string;
    readonly clips: readonly Clip[];
    readonly oud: Scores;
    readonly voice: Scores;
    readonly baseline: {
      readonly name: string;
      readonly oudSiSdr: number;
      readonly voiceSiSdr: number;
    } | null;
  };
  readonly restoration: {
    readonly method: string;
    readonly clips: readonly Clip[];
    readonly noisySnr: number;
    readonly restoredSnr: number;
  };
}

const DATA: DspDemo = dspDemo;
const SYNTHETIC = DATA.source.kind === 'synthetic';

function db(x: number): string {
  return `${x > 0 ? '+' : ''}${x.toFixed(1)} dB`;
}

function ClipCard({ clip }: { readonly clip: Clip }): React.JSX.Element {
  const player = usePlayer();
  const t: PlayerTrack = {
    id: clip.id,
    title: clip.label,
    performer: DATA.source.label,
    src: clip.file,
    durationSec: DATA.seconds,
    rightsLine: DATA.source.label,
  };
  const isActive = player.track?.id === t.id;
  const playing = isActive && (player.status === 'playing' || player.status === 'loading');
  return (
    <li
      className={`rounded-[4px] border p-3 ${isActive ? 'border-accent-live bg-chrome-2' : 'border-hairline bg-chrome-1'}`}
    >
      <button
        type="button"
        aria-label={playing ? `Pause ${clip.label}` : `Play ${clip.label}`}
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
          <span className="block text-sm text-hi">{clip.label}</span>
          <span className="block text-[11px] leading-snug text-low">{clip.what}</span>
        </span>
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- a build artefact with a fixed size */}
      <img
        src={clip.image}
        alt={`Spectrogram of ${clip.label.toLowerCase()}: time left to right, 0 to 4 kHz bottom to top`}
        width={640}
        height={160}
        loading="lazy"
        className="mt-3 block h-auto w-full rounded-[2px] border border-hairline"
      />
    </li>
  );
}

function Row({
  name,
  before,
  after,
  baseline,
}: {
  readonly name: string;
  readonly before: number;
  readonly after: number;
  readonly baseline: number | null;
}): React.JSX.Element {
  return (
    <tr className="border-t border-hairline">
      <th scope="row" className="py-2 pr-4 text-left font-normal text-hi">
        {name}
      </th>
      <td className="py-2 pr-4">{db(before)}</td>
      <td className="py-2 pr-4 text-hi">{db(after)}</td>
      {baseline !== null && <td className="py-2">{db(baseline)}</td>}
    </tr>
  );
}

export function SeparationDemo(): React.JSX.Element {
  const sep = DATA.separation;
  const rest = DATA.restoration;
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
      <p className="numeric text-xs tracking-[0.24em] text-accent-state uppercase">
        Machine listening
      </p>
      <h1 className="mt-3 font-display text-3xl text-hi sm:text-4xl">Separation and restoration</h1>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-mid">
        Two things an archive of old recordings needs: pulling the oud out from under a voice, and
        taking tape noise off a recording. Both are done here with short, classical methods written
        in numpy, and both are scored against a known answer.
      </p>

      <div
        role="note"
        className={`mt-6 rounded-[4px] border px-5 py-4 ${SYNTHETIC ? 'border-dashed border-accent-state' : 'border-hairline'} bg-chrome-1`}
      >
        <p className="text-sm text-hi">{DATA.source.label}</p>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mid">{DATA.source.note}</p>
        {SYNTHETIC && (
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mid">
            A recording of a real oud, made for this project, replaces them when it exists.
          </p>
        )}
      </div>

      <section aria-labelledby="sep-title" className="mt-12">
        <h2 id="sep-title" className="font-display text-2xl text-hi">
          1. Oud and voice, pulled apart
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-mid">
          The method first learns a small dictionary of spectra from the oud alone, playing a
          different piece. It then explains the mixture as that dictionary plus a few free spectra;
          whatever the oud dictionary explains is kept as oud, the rest is the voice. Play the
          original first. The two extracted clips add back up to it exactly.
        </p>
        <ol className="mt-5 grid gap-3 sm:grid-cols-2">
          {sep.clips.map((c) => (
            <ClipCard key={c.id} clip={c} />
          ))}
        </ol>
        <div className="mt-5 overflow-x-auto">
          <table className="numeric w-full min-w-[420px] text-left text-[13px] text-mid">
            <caption className="pb-2 text-left text-[12px] text-low">
              How close each part is to the true take (scale-invariant SDR; higher is better).
            </caption>
            <thead>
              <tr className="text-[11px] tracking-[0.12em] text-low uppercase">
                <th scope="col" className="py-2 pr-4 font-normal">
                  Part
                </th>
                <th scope="col" className="py-2 pr-4 font-normal">
                  In the mixture
                </th>
                <th scope="col" className="py-2 pr-4 font-normal">
                  This method
                </th>
                {sep.baseline && (
                  <th scope="col" className="py-2 font-normal">
                    {sep.baseline.name}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              <Row
                name="Oud"
                before={sep.oud.mixtureSiSdr}
                after={sep.oud.separatedSiSdr}
                baseline={sep.baseline ? sep.baseline.oudSiSdr : null}
              />
              <Row
                name="Voice"
                before={sep.voice.mixtureSiSdr}
                after={sep.voice.separatedSiSdr}
                baseline={sep.baseline ? sep.baseline.voiceSiSdr : null}
              />
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-low">Method: {sep.method}.</p>
      </section>

      <section aria-labelledby="rest-title" className="mt-14">
        <h2 id="rest-title" className="font-display text-2xl text-hi">
          2. Tape noise, taken off
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-mid">
          Cassette-style noise (hiss that rises with frequency, plus mains hum) is added to the
          clean take at a known level. Spectral subtraction estimates the noise from the quietest
          moments and removes that much from every moment. Because the clean take is known, what
          comes back can be measured.
        </p>
        <ol className="mt-5 grid gap-3 sm:grid-cols-2">
          {rest.clips.map((c) => (
            <ClipCard key={c.id} clip={c} />
          ))}
        </ol>
        <dl className="numeric mt-5 grid max-w-md grid-cols-2 gap-4 text-[13px] text-mid">
          <div>
            <dt className="text-[11px] tracking-[0.12em] text-low uppercase">Noisy</dt>
            <dd className="text-lg text-hi">{db(rest.noisySnr)}</dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-[0.12em] text-low uppercase">Restored</dt>
            <dd className="text-lg text-hi">{db(rest.restoredSnr)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-[12px] leading-relaxed text-low">
          Signal-to-noise ratio against the clean take; higher is better. Method: {rest.method}.
        </p>
      </section>

      <section aria-labelledby="limits-title" className="mt-14">
        <h2 id="limits-title" className="font-display text-xl text-hi">
          What this does not show
        </h2>
        <ul className="mt-3 flex max-w-2xl list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-mid">
          <li>
            The oud dictionary has to come from the same instrument, room and microphone. Learned
            from a different session, the method did worse than doing nothing in a test on real
            takes.
          </li>
          <li>
            A pretrained neural separator scores higher on real recordings. This method is here
            because every line of it can be explained, and because it needs one short recording, not
            a training set.
          </li>
          <li>
            The noise is added by the project, so its level is known. Noise on a real cassette is
            not stationary, and restoring one cannot be scored this way.
          </li>
        </ul>
      </section>
    </main>
  );
}
