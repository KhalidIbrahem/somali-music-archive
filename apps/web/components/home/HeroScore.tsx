'use client';

/**
 * HeroScore — the landing page's single signature moment (B1-11): the
 * engraved hero excerpt, playable in place, no sign-in.
 *
 * The engravings arrive as inline SVG strings (desktop: both phrases;
 * mobile: two systems at larger scale). Audio is an HTMLAudioElement created
 * on first play (lazy; never autoplays); the flag-blue playhead and the amber
 * reached-note ink are driven from audio.currentTime each frame, so sync is
 * the media clock itself — pausing, scrubbing the phrase again, or a slow
 * network cannot drift them. With prefers-reduced-motion the playhead steps
 * from note to note instead of sweeping.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface HeroVariant {
  wPx: number;
  hPx: number;
  notes: ReadonlyArray<{ id: string; x: number; y: number }>;
}

export interface HeroNotes {
  durationSec: number;
  times: ReadonlyArray<{ start: number; end: number }>;
  desktop: HeroVariant;
  mobile: HeroVariant;
}

const REACHED_CLASS = 'hero-note-reached';

export function HeroScore({
  svgDesktop,
  svgMobile,
  notes,
}: {
  svgDesktop: string;
  svgMobile: string;
  notes: HeroNotes;
}): React.JSX.Element {
  const desktopRef = useRef<HTMLDivElement>(null);
  const mobileRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef(0);
  const lastActiveRef = useRef(-1);
  const [playing, setPlaying] = useState(false);

  /** The visible engraving (desktop ≥768px) and its coordinate table. */
  const activeVariant = useCallback((): {
    host: HTMLDivElement | null;
    data: HeroVariant;
  } => {
    const desktop = window.matchMedia('(min-width: 768px)').matches;
    return desktop
      ? { host: desktopRef.current, data: notes.desktop }
      : { host: mobileRef.current, data: notes.mobile };
  }, [notes]);

  const clearInk = useCallback((): void => {
    for (const host of [desktopRef.current, mobileRef.current]) {
      host
        ?.querySelectorAll(`.${REACHED_CLASS}`)
        .forEach((el) => el.classList.remove(REACHED_CLASS));
    }
    lastActiveRef.current = -1;
  }, []);

  const stop = useCallback((): void => {
    cancelAnimationFrame(rafRef.current);
    setPlaying(false);
    if (playheadRef.current) playheadRef.current.style.opacity = '0';
  }, []);

  const tick = useCallback((): void => {
    const audio = audioRef.current;
    const { host, data } = activeVariant();
    const playhead = playheadRef.current;
    if (audio === null || host === null || playhead === null) return;

    const t = audio.currentTime;
    // last note whose start has passed
    let active = -1;
    for (let i = 0; i < notes.times.length; i++) {
      const time = notes.times[i];
      if (time !== undefined && time.start <= t) active = i;
      else break;
    }

    // ink every reached note (persistent until the excerpt ends)
    if (active > lastActiveRef.current) {
      for (let i = Math.max(0, lastActiveRef.current); i <= active; i++) {
        const id = data.notes[i]?.id;
        if (id === undefined) continue;
        host.querySelector(`#${CSS.escape(id)}`)?.classList.add(REACHED_CLASS);
      }
      lastActiveRef.current = active;
    }

    // playhead: sweep between this note and the next on the same system;
    // reduced motion steps to the note position instead.
    const cur = active >= 0 ? data.notes[Math.min(active, data.notes.length - 1)] : data.notes[0];
    if (cur !== undefined) {
      const scale = host.clientWidth / data.wPx;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      let x = cur.x;
      const curTime = notes.times[active];
      const nextNote = data.notes[active + 1];
      const nextTime = notes.times[active + 1];
      if (
        !reduce &&
        active >= 0 &&
        curTime !== undefined &&
        nextNote !== undefined &&
        nextTime !== undefined &&
        Math.abs(nextNote.y - cur.y) < 40 // same system — never sweep across the line break
      ) {
        const span = Math.max(0.001, nextTime.start - curTime.start);
        x = cur.x + (nextNote.x - cur.x) * Math.min(1, (t - curTime.start) / span);
      }
      playhead.style.opacity = '1';
      playhead.style.transform = `translateX(${x * scale}px)`;
      playhead.style.top = `${(cur.y - 46) * scale}px`;
      playhead.style.height = `${104 * scale}px`;
    }
  }, [activeVariant, notes]);

  const toggle = useCallback(async (): Promise<void> => {
    let audio = audioRef.current;
    if (audio === null) {
      // Lazy: the mp3 leaves the server only on the first press.
      audio = new Audio('/sample/hero-audio.mp3');
      audio.preload = 'auto';
      audio.addEventListener('ended', () => {
        stop();
        clearInk();
        if (audio !== null) audio.currentTime = 0;
      });
      audioRef.current = audio;
    }
    if (playing) {
      audio.pause();
      stop();
      return;
    }
    if (audio.ended || audio.currentTime >= notes.durationSec) {
      audio.currentTime = 0;
      clearInk();
    }
    await audio.play();
    setPlaying(true);
    function loop(): void {
      tick();
      const a = audioRef.current;
      if (a !== null && !a.paused && !a.ended) rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [playing, notes.durationSec, stop, clearInk, tick]);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      audioRef.current?.pause();
    },
    [],
  );

  return (
    <figure className="min-w-0">
      <div className="relative rounded-[2px] bg-paper px-4 pt-5 pb-4 shadow-2xl ring-1 ring-paper-edge sm:px-8 sm:pt-7 sm:pb-6">
        {/* play control on the score frame (§B1-11) */}
        <button
          type="button"
          onClick={() => void toggle()}
          aria-label={playing ? 'Pause the excerpt' : 'Play the excerpt'}
          className="absolute top-3 right-3 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-paper-edge bg-chrome-1 text-accent-live shadow-lg transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none motion-reduce:transition-none"
        >
          {playing ? (
            <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
              <rect x="2" y="1.5" width="3" height="9" />
              <rect x="7" y="1.5" width="3" height="9" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
              <path d="M2.5 1.2v9.6L11 6 2.5 1.2Z" />
            </svg>
          )}
        </button>

        <p className="font-display text-lg text-confidence-high sm:text-xl">
          Qaraami phrase in A pentatonic
        </p>

        <div className="relative mt-3">
          {/* the flag-blue playhead (§1: playback is blue) */}
          <div
            ref={playheadRef}
            aria-hidden
            className="pointer-events-none absolute left-0 w-[2px] rounded-full bg-accent-live opacity-0"
          />
          <div
            ref={desktopRef}
            className="hero-score hidden md:block [&_svg]:h-auto [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svgDesktop }}
          />
          <div
            ref={mobileRef}
            className="hero-score md:hidden [&_svg]:h-auto [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svgMobile }}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-paper-edge pt-3">
          <figcaption className="text-[11px] tracking-[0.06em] text-confidence-mid [font-variant:small-caps]">
            sample edition · audio synthesized from the notation · somali music archive, 2026
          </figcaption>
          {/* confidence legend (§3): how the archive prints certainty */}
          <div className="flex items-center gap-3 text-[10px] text-confidence-mid">
            <span className="flex items-center gap-1">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-confidence-high" /> ≥ 0.90
            </span>
            <span className="flex items-center gap-1">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-confidence-mid" /> 0.70–0.89
            </span>
            <span className="flex items-center gap-1">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-confidence-low" /> &lt; 0.70
            </span>
          </div>
        </div>
      </div>
    </figure>
  );
}
