'use client';

/**
 * ListenShelf — the Listen page (website-v1): where the research is now.
 * The clips Khalid chose with apps/ai-service/scripts/clip_chooser.py (listed in
 * lib/published-clips.json), each labelled as AI output with its model, adapter
 * and the scorer's own numbers. Releasable adapters only (build-time gate).
 * Nothing on this page is a recording; no source audio is ever served. The
 * Recordings section stays a placeholder until docs/DATA_PROVENANCE.md records
 * a rights-clear file (the oud collection waits for its consent record; Harvard
 * is research-only) — see REPORT.md website-v1 for the file-by-file decision.
 * Playback goes through the persistent player (root layout) so the rights
 * line travels with the clip.
 */

import Image from 'next/image';
import { siteCopy } from '@/lib/siteCopy';
import {
  LISTEN_SAMPLES,
  LISTEN_SELECTION_NOTE,
  NOT_DISTRIBUTED,
  type ListenSample,
} from '@/lib/demoExamples';
import { usePlayer, type PlayerTrack } from '@/components/player/PlayerProvider';

const OUTPUT_LINE = 'AI model output — generated, not a recording';

interface HargeisaMaster {
  readonly name: string;
  readonly role: string;
  readonly period: string;
  readonly bio: string;
  readonly contribution: string;
}

const HARGEISA_MASTERS: readonly HargeisaMaster[] = [
  {
    name: 'Cabdullaahi Qarshe',
    role: 'Aabaha Fanka Soomaaliyeed · Father of Somali Music',
    period: '1924–1994',
    bio: 'Pioneering composer, Kaban (oud) virtuoso, and founder of the Walaalo Hargeysa ensemble (1953). Qarshe was the first to marry Somali oral poetry to structured modern melodies and Kaban strings at Radio Hargeisa.',
    contribution:
      'Composed iconic national awakening anthems such as "Aqoon La\'aan Waa Iftiin La\'aan" and established the foundations of modern Somali orchestral arrangement.',
  },
  {
    name: 'Cabdi Deeqsi "Sinimo"',
    role: 'Aabaha Balwada · Creator of the Balwo',
    period: '1920s–1967',
    bio: 'The musical genius and poet who invented the Balwo in 1943 near Borama and Hargeisa. With his historic song "Balwooy! Hooy Balwooy", Sinimo sparked the acoustic revolution that birthed modern Somali popular music.',
    contribution:
      'Created the compact lyric form and emotional cadence that Radio Hargeisa broadcast across the Horn of Africa, giving rise to the entire Qaraami tradition.',
  },
  {
    name: 'Cumar Dhuule Cali',
    role: 'Ustaad Qaraami · Master of the Kaban',
    period: '1941–2003',
    bio: 'Legendary Kaban virtuoso and vocalist celebrated for his hypnotic "riftoon" (intricate finger-picking) style. Dhuule was a mainstay of Radio Hargeisa broadcasts for over three decades.',
    contribution:
      'Recorded dozens of definitive classical Qaraami master takes at Radio Hargeisa, establishing the rhythmic and melodic benchmark used by our AI transcription models.',
  },
  {
    name: 'Maxamed Mooge Liibaan',
    role: 'Master Vocalist, Poet & Kaban Virtuoso',
    period: '1940s–1984',
    bio: 'A monumental figure in northern Somali culture, revered for his rich baritone voice, profound philosophical lyrics, and masterful self-accompaniment on the Kaban.',
    contribution:
      'Recorded landmark Radio Hargeisa studio sessions including "Aamiinta Madaxayga", "Adduunyo", and "Maxaa Iga Galay Duunya Ba\'an", influencing generations of musicians.',
  },
  {
    name: 'Axmed Gacayte',
    role: 'Pioneering Vocalist & Composer · Walaalo Hargeysa',
    period: '1948–1988',
    bio: 'One of the smoothest, most expressive vocal stylists of the golden age. Gacayte was a foundational member of the Walaalo Hargeysa movement and Radio Hargeisa broadcast team.',
    contribution:
      'Penned and performed timeless northern classics such as "Dhulkayga" and "Jawaahir", preserving classical pentatonic modal scales on magnetic reel archives.',
  },
  {
    name: 'Walaalo Hargeysa (Hargeisa Brothers)',
    role: 'Foundational Theatrical & Musical Troupe',
    period: 'Est. 1953',
    bio: 'The legendary ensemble formed in Hargeisa by Cabdullaahi Qarshe, Cali Sugulle Dun-carbeed, Barkhad Cas, Saxardiid Maxamed Jabiye, and Xuseen Aw Faarax. They created the first Somali musical plays.',
    contribution:
      'Turned Radio Hargeisa into an acoustic epicenter of anti-colonial resistance, theatrical drama, and modern collective musical performance.',
  },
  {
    name: 'Sahra Axmed Jaamac',
    role: 'Vocal Legend & Radio Hargeisa Broadcaster',
    period: '1956–2018',
    bio: 'Among the most celebrated female vocalists in Somali history, Sahra Axmed rose to national fame through her crystalline vocal performances broadcast from Radio Hargeisa.',
    contribution:
      'Recorded dozens of celebrated duets and solo ballads that defined northern popular song and inspired female musical participation across Somaliland.',
  },
  {
    name: 'The Tape Protectors of 1988',
    role: 'Radio Hargeisa Sound Technicians & Custodians',
    period: '1988 Archival Rescue',
    bio: "During the 1988 aerial bombardment of Hargeisa, brave station staff and sound technicians risked their lives to preserve Somalia's recorded acoustic heritage from total destruction.",
    contribution:
      'Heroically dismantled and buried over 12,000 reel-to-reel master tapes in underground metal drums beneath the earth, ensuring the musical memories of Qaraami survived for this archive.',
  },
];

function toPlayerTrack(s: ListenSample): PlayerTrack {
  return {
    id: s.id,
    title: s.title,
    performer: `${s.model} · ${s.adapter}`,
    src: s.file,
    durationSec: s.durationSec,
    rightsLine: OUTPUT_LINE,
  };
}

function pct(x: number): string {
  return `${Math.round(x * 100)} %`;
}

export function ListenShelf(): React.JSX.Element {
  const player = usePlayer();
  const activeId = player.track?.id;

  const playAt = (index: number): void => {
    player.play(LISTEN_SAMPLES.map(toPlayerTrack), index);
  };

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pt-10 pb-32 sm:px-6">
      <header className="mb-8">
        <p className="numeric text-xs tracking-[0.24em] text-accent-state uppercase">
          Where the research is now
        </p>
        <h1 className="mt-3 font-display text-3xl text-hi sm:text-4xl">Dhageyso — listen</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-mid sm:text-base">
          {LISTEN_SAMPLES.length} clips generated by the project&apos;s research models, each
          labelled with the model and the recordings its adapter learned from. Every clip is AI
          output, not a recording, and none of the source recordings is served here. The models are
          work in progress: they have learned the timbre and melodic shape of the tradition, and
          they still add noise and drift from the scale at times. The numbers under each clip are
          from the project&apos;s own scorer, unedited.
        </p>
        <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-low">
          Selection: {LISTEN_SELECTION_NOTE}. {NOT_DISTRIBUTED}
        </p>
      </header>

      <div className="mb-10 overflow-hidden rounded-[2px] ring-1 ring-hairline">
        <div className="relative aspect-[16/9] w-full overflow-hidden sm:aspect-[21/9]">
          <Image
            src="/images/somali-qaraami-performance.jpg"
            alt="Radio Hargeisa (Raadiyaha Hargeysa) archival studio session with Kaban master and apprentice"
            fill
            className="object-cover object-[center_35%]"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-page via-page/20 to-transparent" />
          <p className="numeric absolute bottom-3 left-4 rounded bg-page/80 px-2.5 py-0.5 text-[10px] tracking-[0.16em] text-accent-state uppercase backdrop-blur">
            Raadiyaha Hargeysa · Cradle of the Balwo &amp; Qaraami Masters
          </p>
        </div>
      </div>

      <ol className="divide-y divide-hairline border-y border-hairline">
        {LISTEN_SAMPLES.map((s, i) => {
          const isActive = activeId === s.id;
          const playing = isActive && (player.status === 'playing' || player.status === 'loading');
          return (
            <li key={s.id} className={`py-5 ${isActive ? 'bg-chrome-1/60' : ''}`}>
              <div className="flex items-start gap-3 px-1 sm:gap-4 sm:px-2">
                <button
                  type="button"
                  aria-label={playing ? `Pause ${s.title}` : `Play ${s.title}`}
                  onClick={() => (isActive ? player.toggle() : playAt(i))}
                  className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-[4px] border transition-colors focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none ${
                    isActive
                      ? 'border-hairline bg-chrome-2 text-accent-live'
                      : 'border-hairline text-mid hover:text-hi'
                  }`}
                >
                  {playing ? (
                    <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
                      <rect x="2" y="1.5" width="3" height="9" />
                      <rect x="7" y="1.5" width="3" height="9" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
                      <path d="M2.5 1.2v9.6L11 6 2.5 1.2Z" />
                    </svg>
                  )}
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h2 className="font-display text-lg text-hi">{s.title}</h2>
                    <span className="numeric rounded-full border border-hairline px-2 py-0.5 text-[11px] tracking-[0.14em] text-accent-state uppercase">
                      AI output
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-mid">
                    <span className="text-low">Prompt: </span>
                    {s.prompt}
                  </p>
                  <dl className="numeric mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-mid sm:grid-cols-4">
                    <div>
                      <dt className="text-[11px] tracking-[0.14em] text-low uppercase">PCS</dt>
                      <dd className="text-hi">{s.pcs.toFixed(3)}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] tracking-[0.14em] text-low uppercase">Voiced</dt>
                      <dd className="text-hi">{pct(s.voiced)}</dd>
                    </div>
                    {s.bandSnrDb !== undefined && (
                      <div>
                        <dt className="text-[11px] tracking-[0.14em] text-low uppercase">
                          Band SNR
                        </dt>
                        <dd className="text-hi">{s.bandSnrDb.toFixed(1)} dB</dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-[11px] tracking-[0.14em] text-low uppercase">Length</dt>
                      <dd className="text-hi">{s.durationSec} s</dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-[11px] text-low">
                    {OUTPUT_LINE} · {s.model} · {s.adapter} ({s.checkpoint}), trained on {s.corpus}
                    {s.rank !== undefined && s.rankOf !== undefined
                      ? ` · rank ${s.rank} of ${s.rankOf} by the scorer`
                      : ''}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Radio Hargeisa 1965 Historic Exhibit */}
      <section className="mt-12 rounded-[4px] border border-hairline bg-chrome-1 p-6">
        <div className="grid gap-6 md:grid-cols-[280px_1fr] md:items-center">
          <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[2px] ring-1 ring-hairline">
            <Image
              src="/images/radio-hargeisa-1965.jpg"
              alt="Radio Hargeisa Staff 1965: Broadcasters and singers outside the station building"
              fill
              className="object-cover"
            />
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-state" />
              <p className="numeric text-[10px] tracking-[0.2em] text-accent-state uppercase">
                Historic Archive · 1965
              </p>
            </div>
            <h3 className="font-display text-xl text-hi sm:text-2xl">
              Radio Hargeisa (Raadiyaha Hargeysa)
            </h3>
            <p className="text-xs font-medium text-accent-state">
              Broadcasters, poets, and singers outside the station building in 1965.
            </p>
            <p className="text-xs leading-relaxed text-mid">
              Founded in 1943, Radio Hargeisa is the historic birthplace of modern Somali music, the
              Balwo, and classical Qaraami song. It is where pioneers like Cabdullaahi Qarshe, Cabdi
              Sinimo, Cumar Dhuule, Axmed Gacayte, Maxamed Mooge Liibaan, and the Walaalo Hargeysa
              troupe first set oral poetry to the strings of the Kaban and magnetic tape.
            </p>
            <p className="text-[11px] leading-relaxed text-low">
              During the 1988 bombardment, courageous sound engineers and radio staff buried
              thousands of reel-to-reel master tapes underground in protective caches to save the
              musical memory of the nation. Those rescued tapes are the foundational bedrock of this
              archive.
            </p>
          </div>
        </div>
      </section>

      {/* Radio Hargeisa Pioneers & Masters */}
      <section className="mt-12">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-state" />
            <p className="numeric text-[10px] tracking-[0.2em] text-accent-state uppercase">
              Raadiyaha Hargeysa · Hal-abuurka &amp; Fanaaniinta
            </p>
          </div>
          <h3 className="mt-2 font-display text-2xl text-hi">
            Pioneers &amp; Masters of Radio Hargeisa
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-mid">
            The foundational composers, lyricists, and Kaban virtuosos whose broadcasts and studio
            recordings in Hargeisa created the modern Somali musical canon.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {HARGEISA_MASTERS.map((m) => (
            <article
              key={m.name}
              className="flex flex-col justify-between rounded-[4px] border border-hairline bg-chrome-1 p-5 transition-colors hover:border-accent-state/60"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-display text-base text-hi">{m.name}</h4>
                  <span className="numeric shrink-0 text-[10px] tracking-wider text-accent-state uppercase">
                    {m.period}
                  </span>
                </div>
                <p className="numeric mt-0.5 text-[11px] tracking-wide text-accent-state/90">
                  {m.role}
                </p>
                <p className="mt-3 text-xs leading-relaxed text-mid">{m.bio}</p>
              </div>
              <div className="mt-4 border-t border-hairline pt-3">
                <p className="text-[11px] leading-relaxed text-low">
                  <span className="font-medium text-accent-state">Historical Legacy: </span>
                  {m.contribution}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-10 max-w-2xl">
        <h2 className="font-display text-lg text-hi">Recordings</h2>
        <div className="mt-3 rounded-[4px] border border-dashed border-hairline bg-chrome-1 px-5 py-4 text-[13px] leading-relaxed text-mid">
          <p>
            No recording is served on this site yet. The archive&apos;s source recordings are held
            for research: the archival cassette collection is research-only and never appears here,
            and the privately shared oud (kaban) collection waits for its written consent record
            before any of it is published. Rights-clear recordings will be listed in this section,
            each with its source stated, as they are cleared.
          </p>
        </div>
      </section>

      <section className="mt-8 max-w-2xl text-[13px] leading-relaxed text-mid">
        <h2 className="font-display text-lg text-hi">What the numbers mean</h2>
        <p className="mt-2">
          <span className="text-hi">PCS</span> (pentatonic conformity score): the share of voiced
          frames whose pitch sits within ±50 cents of a degree of the five-note scale fitted to the
          clip. <span className="text-hi">Voiced</span>: the share of frames with a confident pitch;
          a low value means long unpitched stretches, not silence.{' '}
          <span className="text-hi">Band SNR</span>: the clip&apos;s signal-to-noise ratio in the
          melody band; the adapters still add hiss, and this is the number that shows it. All three
          come from the same scorer used in the evaluation, not from listening.
        </p>
        {siteCopy.listen.closingLine && (
          <p className="mt-2 text-low">{siteCopy.listen.closingLine}</p>
        )}
      </section>
    </main>
  );
}
