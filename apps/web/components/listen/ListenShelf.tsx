'use client';

/**
 * ListenShelf — the archive listening room (B1-15): track records at studio
 * density, not a playlist. Every record carries its source-and-rights line;
 * the one transcribed recording exposes "View score", which opens the synced
 * engraving driven by the same player clock.
 */

import { useMemo, useState } from 'react';
import {
  ARCHIVE_TRACKS,
  HARVARD_RIGHTS_LINE,
  SAMPLE_RIGHTS_LINE,
  SAMPLE_SESSION_TRACK,
  type ArchiveTrack,
} from '@/lib/tracks';
import { usePlayer, type PlayerTrack } from '@/components/player/PlayerProvider';
import { ListenScore } from './ListenScore';
import { formatDuration } from '@/components/studio/format';

interface ShelfTrack extends ArchiveTrack {
  rightsLine: string;
  hasScore: boolean;
  /** Detected values exist only where a transcription exists — never invented. */
  detected?: { root: string; bpm: number; grid: string } | undefined;
}

const SHELF: readonly ShelfTrack[] = [
  {
    ...SAMPLE_SESSION_TRACK,
    rightsLine: SAMPLE_RIGHTS_LINE,
    hasScore: true,
    detected: { root: 'A', bpm: 106, grid: 'beat-tracked' },
  },
  ...ARCHIVE_TRACKS.map((t) => ({ ...t, rightsLine: HARVARD_RIGHTS_LINE, hasScore: false })),
];

function toPlayerTrack(t: ShelfTrack): PlayerTrack {
  return {
    id: t.id,
    title: t.title,
    performer: t.artists,
    src: t.src,
    durationSec: t.durationSec,
    rightsLine: t.rightsLine,
    sourceUrl: t.sourceUrl || undefined,
    hasScore: t.hasScore,
  };
}

export function ListenShelf(): React.JSX.Element {
  const player = usePlayer();
  const [query, setQuery] = useState('');
  const [scoreOpen, setScoreOpen] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return SHELF;
    return SHELF.filter(
      (t) => t.title.toLowerCase().includes(q) || t.artists.toLowerCase().includes(q),
    );
  }, [query]);

  const playAt = (track: ShelfTrack): void => {
    const index = visible.findIndex((t) => t.id === track.id);
    player.play(visible.map(toPlayerTrack), Math.max(0, index));
    if (track.hasScore) setScoreOpen(true);
  };

  const activeId = player.track?.id;
  const showScorePanel = scoreOpen && activeId === 'sample-session';

  return (
    <main className="mx-auto w-full max-w-4xl px-6 pt-10 pb-32">
      <header className="mb-6">
        <h1 className="font-display text-3xl text-hi">Dhageyso — the listening room</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mid">
          Digitised cassettes from the tradition, with their sources stated plainly. One recording
          carries an engraved transcription today; play it and the score follows.
        </p>
      </header>

      <div className="mb-6 flex items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title or performer"
          aria-label="Search the listening room"
          className="h-8 w-full max-w-sm rounded-[4px] border border-hairline bg-chrome-2 px-3 text-[13px] text-hi placeholder:text-low focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
        />
        <span className="numeric text-xs text-low">
          {visible.length} of {SHELF.length}
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-[4px] border border-hairline bg-chrome-1 px-6 py-10 text-center">
          <p className="text-sm text-mid">
            No recordings match “{query.trim()}”. The search filter is the only one active.
          </p>
          <button
            type="button"
            onClick={() => setQuery('')}
            className="mt-4 h-8 rounded-[4px] border border-hairline bg-chrome-2 px-4 text-[13px] text-hi transition-colors hover:border-accent-state focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
          >
            Clear the search
          </button>
        </div>
      ) : (
        <ol className="divide-y divide-hairline border-y border-hairline">
          {visible.map((t) => {
            const isActive = activeId === t.id;
            return (
              <li key={t.id} className={`py-4 ${isActive ? 'bg-chrome-1/60' : ''}`}>
                <div className="flex items-start gap-4 px-2">
                  <button
                    type="button"
                    aria-label={
                      isActive && player.status === 'playing'
                        ? `Pause ${t.title}`
                        : `Play ${t.title}`
                    }
                    onClick={() => (isActive ? player.toggle() : playAt(t))}
                    className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] border transition-colors focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none ${
                      isActive
                        ? 'border-hairline bg-chrome-2 text-accent-live'
                        : 'border-hairline text-mid hover:text-hi'
                    }`}
                  >
                    {isActive && (player.status === 'playing' || player.status === 'loading') ? (
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
                        <path d="M2.5 1.2v9.6L11 6 2.5 1.2Z" />
                      </svg>
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <h2 className="font-display text-lg text-hi">{t.title}</h2>
                      <span className="numeric text-xs text-low">
                        {t.year ?? 'undated'} · {formatDuration(t.durationSec)}
                      </span>
                    </div>
                    <p className="text-[13px] text-mid">
                      {t.artists} · ensemble
                      {t.detected !== undefined && (
                        <span className="numeric ml-2 text-xs text-accent-state">
                          root {t.detected.root} · {t.detected.bpm} BPM · {t.detected.grid}
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-low">{t.note}</p>
                    <p className="mt-1 text-[11px] text-low">
                      {t.rightsLine}
                      {t.sourceUrl !== '' && (
                        <>
                          {' '}
                          ·{' '}
                          <a
                            href={t.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent-live underline-offset-2 hover:underline"
                          >
                            Harvard record
                          </a>
                        </>
                      )}
                    </p>
                    {t.hasScore ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (!isActive) playAt(t);
                          setScoreOpen((v) => (isActive ? !v : true));
                        }}
                        className="mt-2 h-7 rounded-[4px] border border-hairline bg-chrome-2 px-3 text-[12px] text-hi transition-colors hover:border-accent-state focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none"
                      >
                        {showScorePanel && isActive ? 'Hide the score' : 'View score'}
                      </button>
                    ) : (
                      <p className="mt-2 text-[12px] text-low">No score for this recording yet.</p>
                    )}
                  </div>
                </div>

                {showScorePanel && isActive && (
                  <div className="mt-4 px-2">
                    <ListenScore />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
