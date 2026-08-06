'use client';

/**
 * PlayerProvider — the archive's one audio player (B1-15).
 *
 * Mounted in the root layout, so the HTMLAudioElement lives above every route:
 * navigation never interrupts playback. Coarse state (track, status, volume)
 * is React state; TIME is not — consumers that need the clock subscribe via
 * onTime and paint imperatively, exactly like the studio's TimelineEngine.
 *
 * Keyboard (no focus traps — plain window listener that yields to form
 * fields): space toggles, ←/→ seek 5s, ↑/↓ volume.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export interface PlayerTrack {
  id: string;
  title: string;
  performer: string;
  src: string;
  durationSec: number;
  /** Always-visible source + rights line (§B1-15: never render without it). */
  rightsLine: string;
  sourceUrl?: string | undefined;
  /** Present when an engraved transcription exists for this recording. */
  hasScore?: boolean | undefined;
}

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

interface PlayerState {
  queue: readonly PlayerTrack[];
  index: number;
  track: PlayerTrack | null;
  status: PlayerStatus;
  /** What failed and what to do — only when status === 'error'. */
  errorMessage: string | null;
  volume: number;
}

interface PlayerApi extends PlayerState {
  play: (queue: readonly PlayerTrack[], index: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (t: number) => void;
  seekBy: (dt: number) => void;
  setVolume: (v: number) => void;
  /** Subscribe to the clock (rAF cadence while playing). Returns unsubscribe. */
  onTime: (cb: (t: number) => void) => () => void;
  /** Current position — for one-off reads (score panel mount, scrub start). */
  getTime: () => number;
}

const PlayerContext = createContext<PlayerApi | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef(0);
  const timeCbs = useRef(new Set<(t: number) => void>());
  const [state, setState] = useState<PlayerState>({
    queue: [],
    index: -1,
    track: null,
    status: 'idle',
    errorMessage: null,
    volume: 0.9,
  });
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const getAudio = useCallback((): HTMLAudioElement => {
    if (audioRef.current === null) {
      const el = new Audio();
      el.preload = 'auto';
      el.volume = stateRef.current.volume;
      audioRef.current = el;
    }
    return audioRef.current;
  }, []);

  const startLoop = useCallback((): void => {
    cancelAnimationFrame(rafRef.current);
    const cbs = timeCbs.current;
    function frame(): void {
      const audio = audioRef.current;
      if (audio === null) return;
      for (const cb of cbs) cb(audio.currentTime);
      if (!audio.paused && !audio.ended) rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
  }, []);

  const loadAndPlay = useCallback(
    (queue: readonly PlayerTrack[], index: number): void => {
      const track = queue[index];
      if (track === undefined) return;
      const audio = getAudio();
      audio.src = track.src;
      audio.currentTime = 0;
      setState((s) => ({ ...s, queue, index, track, status: 'loading', errorMessage: null }));
      void audio
        .play()
        .then(() => {
          setState((s) => ({ ...s, status: 'playing' }));
          startLoop();
        })
        .catch(() => {
          setState((s) => ({
            ...s,
            status: 'error',
            errorMessage: `Could not load “${track.title}”. Check your connection, then press play to retry.`,
          }));
        });
    },
    [getAudio, startLoop],
  );

  const next = useCallback((): void => {
    const { queue, index } = stateRef.current;
    if (index + 1 < queue.length) loadAndPlay(queue, index + 1);
    else setState((s) => ({ ...s, status: 'ended' }));
  }, [loadAndPlay]);

  const prev = useCallback((): void => {
    const { queue, index } = stateRef.current;
    const audio = audioRef.current;
    // convention: within the first 3s go to the previous track, else restart
    if (audio !== null && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    if (index > 0) loadAndPlay(queue, index - 1);
    else if (audio !== null) audio.currentTime = 0;
  }, [loadAndPlay]);

  // wire media events once
  useEffect(() => {
    const audio = getAudio();
    const onWaiting = (): void =>
      setState((s) => (s.status === 'playing' ? { ...s, status: 'loading' } : s));
    const onPlaying = (): void => {
      setState((s) => ({ ...s, status: 'playing', errorMessage: null }));
      startLoop();
    };
    const onPause = (): void =>
      setState((s) =>
        s.status === 'playing' || s.status === 'loading' ? { ...s, status: 'paused' } : s,
      );
    const onEnded = (): void => next();
    const onError = (): void =>
      setState((s) => ({
        ...s,
        status: 'error',
        errorMessage: s.track
          ? `Playback of “${s.track.title}” failed. Press play to retry.`
          : 'Playback failed. Press play to retry.',
      }));
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      cancelAnimationFrame(rafRef.current);
    };
  }, [getAudio, next, startLoop]);

  const toggle = useCallback((): void => {
    const audio = audioRef.current;
    const s = stateRef.current;
    if (audio === null || s.track === null) return;
    if (s.status === 'error') {
      loadAndPlay(s.queue, s.index);
      return;
    }
    if (s.status === 'ended') {
      loadAndPlay(s.queue, 0);
      return;
    }
    if (audio.paused) void audio.play();
    else audio.pause();
  }, [loadAndPlay]);

  const seek = useCallback((t: number): void => {
    const audio = audioRef.current;
    const dur = stateRef.current.track?.durationSec ?? 0;
    if (audio === null) return;
    audio.currentTime = Math.min(Math.max(0, t), Math.max(0, dur - 0.05));
    for (const cb of timeCbs.current) cb(audio.currentTime);
  }, []);

  const seekBy = useCallback(
    (dt: number): void => {
      const audio = audioRef.current;
      if (audio !== null) seek(audio.currentTime + dt);
    },
    [seek],
  );

  const setVolume = useCallback(
    (v: number): void => {
      const clamped = Math.min(1, Math.max(0, v));
      getAudio().volume = clamped;
      setState((s) => ({ ...s, volume: clamped }));
    },
    [getAudio],
  );

  // keyboard — yields to inputs/textareas/contenteditable and to other
  // shortcuts' modifiers; space also yields to buttons (their native action).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (stateRef.current.track === null) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t !== null) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable)
          return;
        if (e.key === ' ' && (tag === 'BUTTON' || tag === 'A')) return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekBy(5);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekBy(-5);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setVolume(stateRef.current.volume + 0.05);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setVolume(stateRef.current.volume - 0.05);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, seekBy, setVolume]);

  const onTime = useCallback((cb: (t: number) => void): (() => void) => {
    timeCbs.current.add(cb);
    return () => timeCbs.current.delete(cb);
  }, []);

  const getTime = useCallback((): number => audioRef.current?.currentTime ?? 0, []);

  const api = useMemo<PlayerApi>(
    () => ({
      ...state,
      play: loadAndPlay,
      toggle,
      next,
      prev,
      seek,
      seekBy,
      setVolume,
      onTime,
      getTime,
    }),
    [state, loadAndPlay, toggle, next, prev, seek, seekBy, setVolume, onTime, getTime],
  );

  return <PlayerContext.Provider value={api}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (ctx === null) throw new Error('usePlayer must be used inside <PlayerProvider>');
  return ctx;
}
