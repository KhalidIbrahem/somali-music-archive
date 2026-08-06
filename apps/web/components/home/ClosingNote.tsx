'use client';

/**
 * ClosingNote — the page ends on a single held note fading to silence
 * (build brief's closing beat). Synthesized in-browser with the same
 * plucked-string model as the hero excerpt: a low A (the sample session's
 * pentatonic root, sounding in the oud register), ~7 seconds to silence.
 * Nothing autoplays; the seal's waveform line flattens as the sound dies.
 */

import { useEffect, useRef, useState } from 'react';
import { QaraamiGenMark } from '@/components/brand/QaraamiGenLogo';

const NOTE_SECONDS = 7;

function playHeldNote(): AudioContext {
  const ctx = new AudioContext();
  const sr = ctx.sampleRate;
  const f = 110; // A2 — the root, an octave below the excerpt's cadence
  const N = Math.round(sr / f);
  const seconds = NOTE_SECONDS;
  const buffer = ctx.createBuffer(1, Math.ceil(sr * seconds), sr);
  const data = buffer.getChannelData(0);
  const line = new Float32Array(N);
  let seed = 987654321 >>> 0;
  for (let i = 0; i < N; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    line[i] = (seed / 0xffffffff) * 2 - 1;
  }
  let idx = 0;
  for (let i = 0; i < data.length; i++) {
    const cur = line[idx] ?? 0;
    const nxt = line[(idx + 1) % N] ?? 0;
    data[i] = cur * 0.5 * Math.exp(-1.1 * (i / sr / seconds) * 3);
    line[idx] = 0.998 * 0.5 * (cur + nxt);
    idx = (idx + 1) % N;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.9, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + seconds);
  src.connect(gain).connect(ctx.destination);
  src.start();
  src.onended = () => void ctx.close();
  return ctx;
}

export function ClosingNote({ hint }: { hint: string }): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'sounding' | 'silent'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const strike = (): void => {
    if (state === 'sounding') return;
    playHeldNote();
    setState('sounding');
    timerRef.current = setTimeout(() => setState('silent'), NOTE_SECONDS * 1000);
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        type="button"
        onClick={strike}
        aria-label={hint}
        className={`flex h-14 w-14 items-center justify-center rounded-full border transition-colors focus-visible:ring-2 focus-visible:ring-accent-live focus-visible:outline-none ${
          state === 'sounding'
            ? 'border-accent-state text-accent-state'
            : 'border-hairline text-mid hover:border-accent-state hover:text-hi'
        }`}
      >
        <QaraamiGenMark size={30} tone={state === 'silent' ? 'mono' : 'duo'} />
      </button>
      <p className="numeric text-[11px] tracking-[0.18em] text-low uppercase" aria-live="polite">
        {state === 'idle' && hint}
        {state === 'sounding' && 'A · sounding'}
        {state === 'silent' && 'silence'}
      </p>
    </div>
  );
}
