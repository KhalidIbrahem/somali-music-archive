'use client';

/**
 * ListeningRoom — the archive's listening experience (/listen).
 *
 * One <audio> element drives everything; a Web Audio AnalyserNode paints a live
 * amber spectrum onto the player canvas while sound plays. Track rows come from
 * lib/tracks.ts (staged Harvard Loeb corpus takes). Loop defaults to the whole
 * programme so the room keeps playing — the archive should never fall silent.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ARCHIVE_TRACKS } from '@/lib/tracks';
import { Reveal } from '@/components/Reveal';

type LoopMode = 'all' | 'one' | 'off';

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ListeningRoom(): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loopMode, setLoopMode] = useState<LoopMode>('all');

  const track = ARCHIVE_TRACKS[index];

  /** Lazily wire the analyser the first time sound starts (needs a user gesture). */
  const ensureAnalyser = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audioCtxRef.current) return;
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.82;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
  }, []);

  /** Paint one frame of the live spectrum — amber bars over the near-black canvas. */
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);

    const { width, height } = canvas;
    g.clearRect(0, 0, width, height);
    const bars = 48;
    const step = Math.floor(data.length / bars);
    const barWidth = width / bars;
    for (let i = 0; i < bars; i += 1) {
      const v = (data[i * step] ?? 0) / 255;
      const barHeight = Math.max(2, v * height * 0.92);
      const x = i * barWidth;
      const grad = g.createLinearGradient(0, height, 0, height - barHeight);
      grad.addColorStop(0, 'rgba(200, 155, 95, 0.28)');
      grad.addColorStop(1, 'rgba(229, 196, 138, 0.95)');
      g.fillStyle = grad;
      g.fillRect(x + barWidth * 0.18, height - barHeight, barWidth * 0.64, barHeight);
    }
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = (): void => {
      drawFrame();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, drawFrame]);

  const playCurrent = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    ensureAnalyser();
    await audioCtxRef.current?.resume();
    await audio.play();
  }, [ensureAnalyser]);

  const selectTrack = useCallback(
    (i: number, autoplay = true) => {
      const audio = audioRef.current;
      setIndex(i);
      setPosition(0);
      if (!audio) return;
      const next = ARCHIVE_TRACKS[i];
      if (next) {
        audio.src = next.src;
        if (autoplay) void playCurrent();
      }
    },
    [playCurrent],
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void playCurrent();
    else audio.pause();
  }, [playCurrent]);

  const step = useCallback(
    (delta: number) => {
      const count = ARCHIVE_TRACKS.length;
      selectTrack((index + delta + count) % count);
    },
    [index, selectTrack],
  );

  const onEnded = useCallback(() => {
    const audio = audioRef.current;
    if (loopMode === 'one' && audio) {
      audio.currentTime = 0;
      void playCurrent();
      return;
    }
    const last = index === ARCHIVE_TRACKS.length - 1;
    if (last && loopMode === 'off') {
      setIsPlaying(false);
      return;
    }
    step(1);
  }, [index, loopMode, playCurrent, step]);

  const cycleLoop = useCallback(() => {
    setLoopMode((m) => (m === 'all' ? 'one' : m === 'one' ? 'off' : 'all'));
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setPosition(seconds);
  }, []);

  const loopLabel =
    loopMode === 'all' ? 'Loop: all' : loopMode === 'one' ? 'Loop: one' : 'Loop: off';

  return (
    <main className="pb-44">
      {/* ── Room header ─────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-line-secondary">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[46rem] rounded-full bg-amber/10 blur-3xl animate-glow-drift"
        />
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-5 px-6 py-20 text-center">
          <Reveal>
            <p className="font-body text-sm uppercase tracking-[0.3em] text-amber">Dhageyso</p>
          </Reveal>
          <Reveal delay={90}>
            <h1 className="font-display text-5xl leading-tight text-ink-primary sm:text-6xl">
              The Listening Room
            </h1>
          </Reveal>
          <Reveal delay={180}>
            <p className="max-w-2xl font-body text-lg leading-relaxed text-ink-secondary">
              Eight takes from 105 digitised cassettes — theatre songs, flag songs, and qaraami
              voices recorded between 1964 and 1976, cleaned and catalogued by the archive pipeline.
              Sourced from the Harvard Loeb Music Library collection.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── Programme ───────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-4xl px-6 py-14">
        <ol className="flex flex-col divide-y divide-line-secondary">
          {ARCHIVE_TRACKS.map((t, i) => {
            const active = i === index;
            return (
              <li key={t.id}>
                <Reveal delay={i * 60}>
                  <div
                    className={`group flex items-center gap-5 rounded-xl px-4 py-5 transition-colors ${
                      active ? 'bg-bg-secondary' : 'hover:bg-bg-secondary/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => (active ? togglePlay() : selectTrack(i))}
                      aria-label={active && isPlaying ? `Pause ${t.title}` : `Play ${t.title}`}
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-all ${
                        active
                          ? 'border-amber bg-amber text-bg-primary'
                          : 'border-line-primary text-ink-secondary group-hover:border-amber group-hover:text-amber'
                      }`}
                    >
                      {active && isPlaying ? <PauseGlyph /> : <PlayGlyph />}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-3">
                        <h3
                          className={`truncate font-display text-xl ${
                            active ? 'text-amber' : 'text-ink-primary'
                          }`}
                        >
                          {t.title}
                        </h3>
                        {active ? (
                          <span className={`eq ${isPlaying ? '' : 'paused'}`} aria-hidden>
                            <span />
                            <span />
                            <span />
                          </span>
                        ) : null}
                      </div>
                      <p className="truncate font-body text-sm text-ink-secondary">{t.artists}</p>
                      <p className="mt-1 hidden font-body text-sm text-ink-tertiary sm:block">
                        {t.note}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span
                        className={`rounded-full border px-2.5 py-0.5 font-body text-xs ${
                          t.year
                            ? 'border-amber/40 text-amber'
                            : 'border-line-primary text-ink-tertiary'
                        }`}
                      >
                        {t.year ?? 'undated'}
                      </span>
                      <span className="font-body text-sm tabular-nums text-ink-tertiary">
                        {formatTime(t.durationSec)}
                      </span>
                      <a
                        href={t.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-body text-xs text-ink-tertiary underline-offset-2 hover:text-amber hover:underline"
                      >
                        Harvard source
                      </a>
                    </div>
                  </div>
                </Reveal>
              </li>
            );
          })}
        </ol>
      </section>

      {/* ── Player bar ──────────────────────────────────────────────────── */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line-primary bg-bg-secondary/95 backdrop-blur">
        <canvas
          ref={canvasRef}
          width={1200}
          height={56}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-14 h-14 w-full opacity-90"
        />
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-6 py-4">
          <div className="flex items-center gap-4">
            <div
              className={`hidden h-12 w-12 shrink-0 items-center justify-center rounded-full border border-amber/40 bg-bg-primary sm:flex ${
                isPlaying ? 'animate-spin-slow' : ''
              }`}
              aria-hidden
            >
              <StarGlyph />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-lg text-ink-primary">{track?.title}</p>
              <p className="truncate font-body text-xs text-ink-secondary">{track?.artists}</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous track"
                className="flex h-10 w-10 items-center justify-center rounded-full text-ink-secondary transition-colors hover:text-amber"
              >
                <PrevGlyph />
              </button>
              <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-amber text-bg-primary transition-transform hover:scale-105"
              >
                {isPlaying ? <PauseGlyph /> : <PlayGlyph />}
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next track"
                className="flex h-10 w-10 items-center justify-center rounded-full text-ink-secondary transition-colors hover:text-amber"
              >
                <NextGlyph />
              </button>
              <button
                type="button"
                onClick={cycleLoop}
                aria-label={loopLabel}
                title={loopLabel}
                className={`ml-1 flex h-10 items-center gap-1.5 rounded-full border px-3 font-body text-xs transition-colors ${
                  loopMode === 'off'
                    ? 'border-line-primary text-ink-tertiary'
                    : 'border-amber/50 text-amber'
                }`}
              >
                <LoopGlyph />
                {loopMode === 'one' ? '1' : loopMode === 'all' ? 'all' : 'off'}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="w-10 text-right font-body text-xs tabular-nums text-ink-tertiary">
              {formatTime(position)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || track?.durationSec || 0}
              step={1}
              value={Math.min(position, duration || Number.MAX_SAFE_INTEGER)}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="Seek"
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-line-primary accent-amber"
            />
            <span className="w-10 font-body text-xs tabular-nums text-ink-tertiary">
              {formatTime(duration || track?.durationSec || 0)}
            </span>
          </div>
        </div>
      </div>

      <audio
        ref={audioRef}
        src={track?.src}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={onEnded}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />
    </main>
  );
}

/* ── Player glyphs (inline SVG, currentColor) ─────────────────────────────── */

function PlayGlyph(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  );
}

function PauseGlyph(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function PrevGlyph(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 6h2v12H7V6Zm12 0v12l-9-6 9-6Z" />
    </svg>
  );
}

function NextGlyph(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M15 6h2v12h-2V6ZM5 6l9 6-9 6V6Z" />
    </svg>
  );
}

function LoopGlyph(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M17 2v4H7a4 4 0 0 0-4 4v1m4 11v-4h10a4 4 0 0 0 4-4v-1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StarGlyph(): React.JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#C89B5F" aria-hidden>
      <path d="m12 2 2.35 7.16H22l-6.18 4.42L18.18 21 12 16.58 5.82 21l2.36-7.42L2 9.16h7.65L12 2Z" />
    </svg>
  );
}
