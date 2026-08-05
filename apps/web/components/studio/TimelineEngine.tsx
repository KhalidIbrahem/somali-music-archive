'use client';

/**
 * TimelineEngine — the studio's ONE cursor (B1-05, §2 "non-negotiable").
 *
 * Zero drift by construction: position is derived from
 * AudioContext.currentTime — the clock of the hardware actually rendering the
 * audio — never from wall time or rAF accumulation. Waveform playhead, score
 * highlight, and transport timecode are all functions of getTime(), so they
 * cannot disagree with the sound or each other, for three minutes or thirty.
 *
 * Consumers subscribe imperatively (onFrame/onTransport); per-frame updates
 * never pass through React state. AudioBufferSourceNodes are one-shot, so
 * play/seek recreate the source at the requested offset (sample-accurate).
 */

import { createContext, useContext, useEffect, useState } from 'react';
import { getAudioContext, loadSampleBuffer } from './audio';
import { useStudio } from './StudioState';

type FrameCb = (t: number) => void;
type TransportCb = (playing: boolean) => void;

export interface TimelineEngine {
  getTime(): number;
  getDuration(): number;
  isPlaying(): boolean;
  play(): Promise<void>;
  pause(): void;
  toggle(): Promise<void>;
  /** Move the cursor. Sample-accurate: a new source starts exactly at t. */
  seek(t: number): void;
  onFrame(cb: FrameCb): () => void;
  onTransport(cb: TransportCb): () => void;
}

interface InternalEngine extends TimelineEngine {
  setDuration(d: number): void;
  dispose(): void;
}

function createEngine(): InternalEngine {
  let duration = 0;
  let playing = false;
  /** Cursor position while paused; position at source start while playing. */
  let offset = 0;
  /** AudioContext.currentTime when the current source started. */
  let startCtx = 0;
  let source: AudioBufferSourceNode | null = null;
  let raf = 0;
  const frameCbs = new Set<FrameCb>();
  const transportCbs = new Set<TransportCb>();

  const now = (): number => {
    if (!playing) return offset;
    return Math.min(offset + (getAudioContext().currentTime - startCtx), duration);
  };

  const emitFrame = (): void => {
    const t = now();
    for (const cb of frameCbs) cb(t);
  };
  const emitTransport = (): void => {
    for (const cb of transportCbs) cb(playing);
  };

  const stopSource = (): void => {
    if (source === null) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // never started or already stopped — nothing to do
    }
    source.disconnect();
    source = null;
  };

  const tick = (): void => {
    emitFrame();
    if (playing && now() >= duration) {
      stopSource();
      playing = false;
      offset = duration;
      emitTransport();
      emitFrame();
      return;
    }
    if (playing) raf = requestAnimationFrame(tick);
  };

  const startSource = (buffer: AudioBuffer, at: number): void => {
    const ctx = getAudioContext();
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    offset = at;
    startCtx = ctx.currentTime;
    source.start(0, at);
  };

  return {
    getTime: now,
    getDuration: () => duration,
    isPlaying: () => playing,

    async play(): Promise<void> {
      if (playing) return;
      const ctx = getAudioContext();
      await ctx.resume();
      const buffer = await loadSampleBuffer();
      if (playing) return;
      startSource(buffer, offset >= duration ? 0 : offset);
      playing = true;
      emitTransport();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    },

    pause(): void {
      if (!playing) return;
      offset = now();
      stopSource();
      playing = false;
      cancelAnimationFrame(raf);
      emitTransport();
      emitFrame();
    },

    async toggle(): Promise<void> {
      if (playing) this.pause();
      else await this.play();
    },

    seek(t: number): void {
      const clamped = Math.min(duration, Math.max(0, t));
      if (playing) {
        stopSource();
        void loadSampleBuffer().then((buffer) => {
          // still playing? a pause may have raced the async buffer access
          if (!playing) {
            offset = clamped;
            emitFrame();
            return;
          }
          startSource(buffer, clamped);
        });
        offset = clamped;
        startCtx = getAudioContext().currentTime;
      } else {
        offset = clamped;
      }
      emitFrame();
    },

    onFrame(cb: FrameCb): () => void {
      frameCbs.add(cb);
      return () => frameCbs.delete(cb);
    },
    onTransport(cb: TransportCb): () => void {
      transportCbs.add(cb);
      return () => transportCbs.delete(cb);
    },

    setDuration(d: number): void {
      duration = d;
    },
    dispose(): void {
      stopSource();
      playing = false;
      cancelAnimationFrame(raf);
      frameCbs.clear();
      transportCbs.clear();
    },
  };
}

const TimelineContext = createContext<TimelineEngine | null>(null);

export function TimelineProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { session } = useStudio();
  // useState initializer: exactly one engine per provider, stable identity.
  const [engine] = useState(createEngine);

  useEffect(() => {
    if (session !== null) engine.setDuration(session.meta.durationSec);
  }, [session, engine]);

  useEffect(() => () => engine.dispose(), [engine]);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      // verification hook for the headless harness (dev only)
      (window as unknown as Record<string, unknown>)['__timelineDebug'] = engine;
    }
  }, [engine]);

  return <TimelineContext.Provider value={engine}>{children}</TimelineContext.Provider>;
}

export function useTimeline(): TimelineEngine {
  const ctx = useContext(TimelineContext);
  if (ctx === null) throw new Error('useTimeline must be used inside <TimelineProvider>');
  return ctx;
}
