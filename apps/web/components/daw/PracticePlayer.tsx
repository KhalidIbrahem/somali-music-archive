'use client';

/**
 * PracticePlayer — listen to one audio region slowed down, pitch kept, for
 * learning a phrase by ear. Plays the region's span of its file through an
 * <audio> element (`preservesPitch`, the browser's own time-stretch), apart
 * from the arrangement: the transport stops first so the two never overlap.
 * Sources are the same ones the engine plays — 'idb:' blobs from this browser
 * or same-origin QaraamiGen clips — so nothing leaves the machine.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAudio, isIdbSource } from '@/lib/daw/audioStore';
import type { DawEngine } from '@/lib/daw/engine';
import type { DawAudioRegion } from '@/lib/daw/types';

const SPEEDS = [0.5, 0.75, 1] as const;

export function PracticePlayer({
  engine,
  region,
  secPerBeat,
}: {
  engine: DawEngine;
  region: DawAudioRegion;
  secPerBeat: number;
}): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  const [speed, setSpeed] = useState<number>(0.75);
  const [loop, setLoop] = useState(true);
  // Read by the timeupdate handler, so toggling Loop mid-play takes effect.
  const loopRef = useRef(loop);
  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startSec = Math.max(0, region.offsetSec);
  const endSec = startSec + region.lengthBeats * secPerBeat;

  const stop = useCallback((): void => {
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  // New region (or unmount): stop and release the blob URL.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
      setPlaying(false);
    };
  }, [region.source]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  const play = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      if (!audioRef.current) {
        let url = region.source;
        if (isIdbSource(region.source)) {
          const blob = await getAudio(region.source);
          if (!blob) throw new Error('This recording is no longer stored in this browser.');
          objectUrl.current = URL.createObjectURL(blob);
          url = objectUrl.current;
        }
        const el = new Audio(url);
        el.preservesPitch = true;
        el.addEventListener('ended', () => setPlaying(false));
        audioRef.current = el;
      }
      const el = audioRef.current;
      el.playbackRate = speed;
      el.ontimeupdate = () => {
        if (el.currentTime >= endSec) {
          if (loopRef.current) el.currentTime = startSec;
          else {
            el.pause();
            setPlaying(false);
          }
        }
      };
      engine.stop();
      if (el.currentTime < startSec || el.currentTime >= endSec) el.currentTime = startSec;
      await el.play();
      setPlaying(true);
    } catch (err) {
      setPlaying(false);
      setError(err instanceof Error ? err.message : 'Playback failed.');
    }
  }, [endSec, engine, region.source, speed, startSec]);

  const btn =
    'numeric rounded-[4px] border px-2 py-1 text-[10px] tracking-[0.12em] uppercase transition-colors';

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Practice playback">
      <span className="numeric text-[10px] tracking-[0.14em] text-low uppercase">Practice</span>
      <button
        type="button"
        onClick={() => (playing ? stop() : void play())}
        aria-label={playing ? 'Stop practice playback' : 'Play the region slowed down'}
        className={`${btn} ${playing ? 'border-accent-state text-accent-state' : 'border-hairline text-hi hover:border-accent-state'}`}
      >
        {playing ? '■ Stop' : '▶ Play'}
      </button>
      {SPEEDS.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={speed === s}
          onClick={() => setSpeed(s)}
          className={`${btn} ${speed === s ? 'border-accent-state text-accent-state' : 'border-hairline text-low hover:text-hi'}`}
        >
          {Math.round(s * 100)}%
        </button>
      ))}
      <button
        type="button"
        aria-pressed={loop}
        onClick={() => setLoop((v) => !v)}
        className={`${btn} ${loop ? 'border-accent-state text-accent-state' : 'border-hairline text-low hover:text-hi'}`}
      >
        Loop
      </button>
      {error ? (
        <span className="text-[11px] text-danger" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
