'use client';

/**
 * ArchivalAudioSection — The preserved Somali Qaraami master recordings shelf.
 * Features the 100-year heritage icon and the 7 authentic Kaban & voice MP3s
 * from /audio/, connected to the root audio player.
 */

import Image from 'next/image';
import { usePlayer, type PlayerTrack } from '@/components/player/PlayerProvider';

interface ArchivalTrackItem extends PlayerTrack {
  readonly note: string;
  readonly category: string;
}

const ARCHIVAL_TRACKS: readonly ArchivalTrackItem[] = [
  {
    id: 'oud_awliyo_heelo',
    title: 'Awliyo heelo',
    performer: 'Kaban and voice',
    category: 'Heelo · Traditional',
    src: '/audio/qaraami-awliyo-heelo.mp3',
    durationSec: 165,
    note: 'A short heelo in the authentic qaraami manner, oud-led.',
    rightsLine: 'Source: private archive collection — rights remain with their holders',
  },
  {
    id: 'oud_heeri_maahee',
    title: 'Heeri maahee',
    performer: 'Kaban and voice',
    category: 'Qaraami Song',
    src: '/audio/qaraami-heeri-maahee.mp3',
    durationSec: 276,
    note: 'Qaraami song with the oud carrying the line throughout.',
    rightsLine: 'Source: private archive collection — rights remain with their holders',
  },
  {
    id: 'oud_isku_shuban',
    title: 'Isku shuban — kaban keliya',
    performer: 'Kaban (oud) solo',
    category: 'Solo Instrumental Medley',
    src: '/audio/qaraami-isku-shuban-kaban.mp3',
    durationSec: 606,
    note: 'A ten-minute medley on the oud alone — no voice, just the strings.',
    rightsLine: 'Source: private archive collection — rights remain with their holders',
  },
  {
    id: 'oud_laxanka',
    title: 'Laxanka qaraamiga — riftoon',
    performer: 'Kaban and voice',
    category: 'Riftoon Manner',
    src: '/audio/qaraami-laxanka.mp3',
    durationSec: 265,
    note: 'A qaraami melody in the classical riftoon manner.',
    rightsLine: 'Source: private archive collection — rights remain with their holders',
  },
  {
    id: 'oud_raaxeeye',
    title: 'Raaxeeye hadmooyee',
    performer: 'Kaban and voice',
    category: 'Contemplative Pulse',
    src: '/audio/qaraami-raaxeeye.mp3',
    durationSec: 369,
    note: 'A patient qaraami performance built on the oud’s pulse.',
    rightsLine: 'Source: private archive collection — rights remain with their holders',
  },
  {
    id: 'oud_subcis_balwo',
    title: 'Subcis — balwo',
    performer: 'Kaban and voice',
    category: 'Balwo Verses',
    src: '/audio/qaraami-subcis-balwo.mp3',
    durationSec: 555,
    note: 'Balwo verses over the oud — the short love-lyric form qaraami grew from.',
    rightsLine: 'Source: private archive collection — rights remain with their holders',
  },
  {
    id: 'oud_tagay_luula',
    title: 'Tagay — luula',
    performer: 'Kaban and voice',
    category: 'Slow Ballad',
    src: '/audio/qaraami-tagay-luula.mp3',
    durationSec: 261,
    note: 'Slow qaraami — the oud and the melody leaning on each other.',
    rightsLine: 'Source: private archive collection — rights remain with their holders',
  },
];

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function ArchivalAudioSection(): React.JSX.Element {
  const player = usePlayer();
  const activeId = player.track?.id;
  const isPlayingGlobal = player.status === 'playing' || player.status === 'loading';

  const handlePlayAt = (index: number): void => {
    player.play(ARCHIVAL_TRACKS, index);
  };

  return (
    <section id="archival-sessions" className="border-t border-hairline bg-page/40">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 py-24 sm:px-6">
        {/* Header */}
        <div className="max-w-2xl">
          <p className="numeric text-xs tracking-[0.24em] text-accent-state uppercase">
            Maqalka Qaraamiga · Preserved Master Sessions
          </p>
          <h2 className="mt-4 font-display text-3xl text-hi sm:text-4xl">
            The Living Kaban & Voice Recordings
          </h2>
          <p className="mt-3 leading-relaxed text-mid">
            Seven authentic archival takes from the private Qaraami collection. Unhurried solo kaban
            (oud) improvisations, classical heelo melodies, and poetic balwo verses preserved with
            their natural acoustic warmth.
          </p>
        </div>

        {/* Two-column exhibit layout */}
        <div className="grid gap-8 lg:grid-cols-[340px_1fr] lg:items-start">
          {/* Left: 100-Year Heritage Icon & Plaque */}
          <div className="flex flex-col gap-4 rounded-[4px] border border-hairline bg-chrome-1 p-6">
            <div className="relative aspect-square w-full overflow-hidden rounded-[2px] ring-1 ring-hairline">
              <Image
                src="/images/somali-qaraami-icon.jpg"
                alt="Hidaha Muusikada Qaraami — Somali Music Heritage 100-Year Icon Medallion"
                fill
                className="object-cover transition-transform duration-700 hover:scale-105"
                priority
              />
              <div className="absolute inset-0 bg-gradient-to-t from-page/90 via-page/20 to-transparent" />
              <p className="numeric absolute bottom-3 left-3 text-[10px] tracking-[0.2em] text-accent-state uppercase backdrop-blur-sm">
                Astanta Dhaxalka &amp; Maansada Qaraamiga
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-state" />
                <span className="numeric text-[10px] tracking-[0.2em] text-accent-state uppercase">
                  Kaydka Boqolka Sano (100-Year Heritage)
                </span>
              </div>
              <h3 className="font-display text-lg text-hi">Heesihii Hore &amp; Geedka Tixda</h3>
              <p className="text-xs leading-relaxed text-mid italic">
                &ldquo;Shanqadha xadhkaha kabanka iyo codkii qaraamiga — waa dhaxal ma-guuraan ah,
                oo facba fac u dhiibay xusuusta iyo maansada suugaanta Soomaaliyeed.&rdquo;
              </p>
              <p className="text-[11px] leading-relaxed text-low">
                Preserved institutional seal of the Somali Music Archive. Celebrating a century of
                oral poetic verse, pentatonic kaban improvisations, and timeless acoustic memory.
              </p>
              <div className="mt-3 flex items-center justify-between border-t border-hairline pt-3">
                <span className="numeric text-[11px] tracking-wider text-low uppercase">
                  7 Master Takes
                </span>
                <button
                  type="button"
                  onClick={() => handlePlayAt(0)}
                  className="rounded-[3px] border border-accent-state/60 bg-accent-state/10 px-3 py-1 text-xs font-semibold text-accent-state transition-colors hover:bg-accent-state hover:text-page"
                >
                  Play All
                </button>
              </div>
            </div>
          </div>

          {/* Right: Audio Tracks List */}
          <ol className="divide-y divide-hairline rounded-[4px] border border-hairline bg-chrome-1/60">
            {ARCHIVAL_TRACKS.map((t, idx) => {
              const isActive = activeId === t.id;
              const isPlaying = isActive && isPlayingGlobal;
              return (
                <li
                  key={t.id}
                  className={`group flex items-start gap-4 p-4 transition-colors hover:bg-chrome-2/50 ${
                    isActive ? 'bg-chrome-2/80' : ''
                  }`}
                >
                  {/* Play Button */}
                  <button
                    type="button"
                    aria-label={isPlaying ? `Pause ${t.title}` : `Play ${t.title}`}
                    onClick={() => (isActive ? player.toggle() : handlePlayAt(idx))}
                    className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[3px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-live ${
                      isActive
                        ? 'border-accent-state bg-accent-state text-page'
                        : 'border-hairline bg-chrome-1 text-mid group-hover:border-accent-state group-hover:text-hi'
                    }`}
                  >
                    {isPlaying ? (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="currentColor"
                        aria-hidden
                      >
                        <rect x="2" y="1.5" width="3" height="9" />
                        <rect x="7" y="1.5" width="3" height="9" />
                      </svg>
                    ) : (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="currentColor"
                        aria-hidden
                      >
                        <path d="M2.5 1.5v9L10 6 2.5 1.5Z" />
                      </svg>
                    )}
                  </button>

                  {/* Track Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-display text-base text-hi group-hover:text-accent-state sm:text-lg">
                          {t.title}
                        </span>
                        {isActive && isPlaying && (
                          <span
                            aria-hidden
                            className="inline-flex items-center gap-0.5"
                            title="Playing"
                          >
                            <span className="h-2 w-0.5 animate-pulse bg-accent-state" />
                            <span className="h-3 w-0.5 animate-pulse delay-75 bg-accent-state" />
                            <span className="h-2.5 w-0.5 animate-pulse delay-150 bg-accent-state" />
                          </span>
                        )}
                      </div>
                      <span className="numeric text-xs text-mid">{formatTime(t.durationSec)}</span>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="numeric text-[11px] tracking-wider text-accent-state uppercase">
                        {t.category}
                      </span>
                      <span className="text-[11px] text-low">·</span>
                      <span className="text-[11px] text-mid">{t.performer}</span>
                    </div>

                    <p className="mt-1.5 text-xs leading-relaxed text-mid">{t.note}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
