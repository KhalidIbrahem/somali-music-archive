'use client';

/**
 * LearnRhythm (Studio v3) — the durbaan lesson: listen to a Somali groove at
 * the project tempo, then tap along and see every stroke scored against the
 * pattern (lib/learn/tapTrainer). Taps arrive from the Tap button, the
 * space bar (DawApp forwards it while this lesson listens), the durbaan pads
 * and musical typing — anything that produces a note-on.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DawEngine } from '@/lib/daw/engine';
import { GROOVE_PRESETS, STEPS_PER_BAR, type GroovePreset } from '@/lib/daw/grooves';
import {
  countInEvents,
  scheduleAuditions,
  type AuditionEvent,
  type Cancel,
} from '@/lib/learn/audition';
import { RHYTHM_LESSON } from '@/lib/learn/lessons';
import { expectedOnsets, scoreTaps, type TapLane, type TapResult } from '@/lib/learn/tapTrainer';
import { DURBAAN_LANES, type DawProject } from '@/lib/daw/types';
import type { NoteEvent } from './LearnPanel';

const LANES: { id: TapLane; label: string }[] = [
  { id: 0, label: 'Dum' },
  { id: 1, label: 'Tak' },
  { id: 2, label: 'Slap' },
  { id: 'all', label: 'All strokes' },
];
const BARS = 2;
const TOLERANCE_MS = 120;

type Phase =
  | { kind: 'idle' }
  | { kind: 'listening' }
  | { kind: 'countin' }
  | { kind: 'practising'; startMs: number }
  | { kind: 'result'; result: TapResult; calibrationMs: number };

function grooveEvents(
  preset: GroovePreset,
  bpm: number,
  beatsPerBar: number,
  bars: number,
  startMs: number,
  onlyLane: TapLane | null,
  velocityScale = 1,
): AuditionEvent[] {
  const stepMs = ((60000 / bpm) * beatsPerBar) / STEPS_PER_BAR;
  const out: AuditionEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    preset.lanes.forEach((lane, laneIndex) => {
      if (onlyLane !== null && onlyLane !== 'all' && onlyLane !== laneIndex) return;
      lane.forEach((velocity, step) => {
        if (velocity <= 0) return;
        out.push({
          atMs: startMs + (bar * STEPS_PER_BAR + step) * stepMs,
          instrument: 'durbaan',
          midi: DURBAAN_LANES[laneIndex]?.midi ?? 36,
          velocity: Math.min(1, velocity * velocityScale),
        });
      });
    });
  }
  return out;
}

export function LearnRhythm({
  project,
  engine,
  subscribeNotes,
  subscribeTaps,
}: {
  project: DawProject;
  engine: DawEngine;
  subscribeNotes: (listener: (ev: NoteEvent) => void) => () => void;
  subscribeTaps: (listener: (timeMs: number) => void) => () => void;
}): React.JSX.Element {
  const [presetId, setPresetId] = useState(GROOVE_PRESETS[0]?.id ?? 'heello');
  const [lane, setLane] = useState<TapLane>(0);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [calibrate, setCalibrate] = useState(false);
  const [lastBias, setLastBias] = useState(0);
  const cancelRef = useRef<Cancel | null>(null);
  const tapsRef = useRef<number[]>([]);
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;

  const preset = GROOVE_PRESETS.find((p) => p.id === presetId) ?? GROOVE_PRESETS[0];
  const bpm = project.bpm;
  const beatsPerBar = project.timeSignature.beatsPerBar;
  const barMs = (60000 / bpm) * beatsPerBar;

  const stop = useCallback((): void => {
    cancelRef.current?.();
    cancelRef.current = null;
    setPhase({ kind: 'idle' });
  }, []);
  useEffect(() => () => cancelRef.current?.(), []);

  const listen = (): void => {
    if (!preset) return;
    cancelRef.current?.();
    const events = grooveEvents(preset, bpm, beatsPerBar, BARS, 0, null);
    cancelRef.current = scheduleAuditions(
      engine,
      events,
      () => setPhase({ kind: 'idle' }),
      barMs * BARS + 200,
    );
    setPhase({ kind: 'listening' });
  };

  const practise = (): void => {
    if (!preset) return;
    cancelRef.current?.();
    tapsRef.current = [];
    const countIn = countInEvents(bpm, beatsPerBar, 0);
    const patternStart = barMs;
    // The pattern plays softly underneath (the lane being practised quieter still).
    const pattern = grooveEvents(preset, bpm, beatsPerBar, BARS, patternStart, null, 0.55);
    const t0 = performance.now();
    cancelRef.current = scheduleAuditions(
      engine,
      [...countIn, ...pattern],
      () => {
        const expected = expectedOnsets(preset, lane, bpm, beatsPerBar, BARS);
        const startMs = t0 + patternStart;
        const calibrationMs = calibrate ? lastBias : 0;
        const taps = tapsRef.current.map((ms) => (ms - startMs - calibrationMs) / 1000);
        const result = scoreTaps(taps, expected, TOLERANCE_MS);
        if (result.hits.length > 0) {
          setLastBias(result.hits.reduce((s, h) => s + h.errorMs, 0) / result.hits.length);
        }
        setPhase({ kind: 'result', result, calibrationMs });
      },
      patternStart + barMs * BARS + TOLERANCE_MS + 60,
    );
    setPhase({ kind: 'countin' });
    window.setTimeout(() => {
      if (phaseRef.current.kind === 'countin')
        setPhase({ kind: 'practising', startMs: t0 + patternStart });
    }, patternStart);
  };

  const tap = useCallback((timeMs: number): void => {
    const p = phaseRef.current;
    if (p.kind === 'practising' || p.kind === 'countin') tapsRef.current.push(timeMs);
  }, []);

  useEffect(() => {
    const offNotes = subscribeNotes((ev) => {
      if (ev.type === 'on') tap(ev.timeMs);
    });
    const offTaps = subscribeTaps(tap);
    return () => {
      offNotes();
      offTaps();
    };
  }, [subscribeNotes, subscribeTaps, tap]);

  const busy =
    phase.kind === 'listening' || phase.kind === 'countin' || phase.kind === 'practising';
  const chip = (active: boolean): string =>
    `numeric h-7 rounded-[3px] border px-2 text-[10px] tracking-[0.08em] uppercase transition-colors ${
      active
        ? 'border-accent-state bg-accent-state/15 text-accent-state'
        : 'border-hairline text-low hover:text-hi'
    }`;

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3 lg:flex-row">
      <div className="flex max-w-md flex-col gap-3">
        <p className="text-[12px] leading-snug text-mid">{RHYTHM_LESSON.intro}</p>
        <ol className="flex flex-col gap-1.5 pl-4 text-[11px] leading-snug text-mid">
          {RHYTHM_LESSON.steps.map((s) => (
            <li key={s} className="list-decimal">
              {s}
            </li>
          ))}
        </ol>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="numeric text-[9px] tracking-[0.14em] text-low uppercase">Groove</span>
          {GROOVE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={presetId === p.id}
              onClick={() => setPresetId(p.id)}
              className={chip(presetId === p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="numeric text-[9px] tracking-[0.14em] text-low uppercase">Practise</span>
          {LANES.map((l) => (
            <button
              key={String(l.id)}
              type="button"
              aria-pressed={lane === l.id}
              onClick={() => setLane(l.id)}
              className={chip(lane === l.id)}
            >
              {l.label}
            </button>
          ))}
          <label className="numeric ml-auto flex items-center gap-1 text-[9px] tracking-[0.14em] text-low uppercase">
            <input
              type="checkbox"
              checked={calibrate}
              onChange={(e) => setCalibrate(e.target.checked)}
              className="accent-(--accent-state)"
            />
            Calibrate ({Math.round(lastBias)} ms)
          </label>
        </div>

        {preset ? (
          <div
            className="flex flex-col gap-0.5 rounded-[4px] border border-hairline bg-chrome-2 p-2"
            aria-label={`${preset.label} pattern`}
          >
            {preset.lanes.map((row, laneIndex) => (
              <div key={laneIndex} className="flex items-center gap-1.5">
                <span
                  className={`numeric w-8 text-[9px] uppercase ${lane === laneIndex || lane === 'all' ? 'text-accent-state' : 'text-low'}`}
                >
                  {DURBAAN_LANES[laneIndex]?.label}
                </span>
                <div className="grid flex-1 grid-cols-16 gap-px">
                  {row.map((v, step) => (
                    <span
                      key={step}
                      className={`h-3 rounded-[1px] ${
                        v <= 0
                          ? step % 4 === 0
                            ? 'bg-hairline'
                            : 'bg-hairline/50'
                          : v < 0.85
                            ? 'bg-accent-state/70'
                            : 'bg-accent-state'
                      }`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={busy ? stop : listen}
            className="numeric h-9 rounded-[4px] border border-hairline px-3 text-[11px] tracking-[0.1em] text-hi uppercase hover:border-accent-state"
          >
            {phase.kind === 'listening' ? '■ Stop' : '▶ Listen'}
          </button>
          <button
            type="button"
            onClick={busy ? stop : practise}
            className="numeric h-9 rounded-[4px] bg-accent-state px-3 text-[11px] font-semibold tracking-[0.1em] text-page uppercase hover:brightness-110"
          >
            {phase.kind === 'countin' || phase.kind === 'practising' ? '■ Stop' : 'Practise'}
          </button>
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              tap(performance.now());
              engine.unlock();
              engine.audition('durbaan', lane === 1 ? 38 : lane === 2 ? 42 : 36, 0.9);
            }}
            className="numeric h-9 min-w-24 touch-none rounded-[4px] border border-accent-state/60 px-3 text-[11px] tracking-[0.1em] text-accent-state uppercase select-none active:bg-accent-state active:text-page"
          >
            Tap
          </button>
          <span className="numeric text-[10px] text-low">
            {phase.kind === 'countin'
              ? 'count-in…'
              : phase.kind === 'practising'
                ? 'play!'
                : phase.kind === 'listening'
                  ? 'listening'
                  : 'space bar, pads or typing also count as taps'}
          </span>
        </div>

        {phase.kind === 'result' ? <TapResultView result={phase.result} /> : null}
      </div>
    </div>
  );
}

function TapResultView({ result }: { result: TapResult }): React.JSX.Element {
  const total = result.hits.length + result.misses.length;
  return (
    <div
      className="flex flex-col gap-2 rounded-[4px] border border-hairline bg-chrome-2 p-3"
      role="status"
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-display text-3xl text-hi">{result.score}</span>
        <span className="numeric text-[10px] tracking-[0.14em] text-accent-state uppercase">
          {result.score >= 85 ? 'excellent' : result.score >= 60 ? 'good' : 'keep practising'}
        </span>
        <span className="numeric text-[10px] text-mid">
          {result.hits.length}/{total} strokes · {result.extras.length} extra · ±
          {Math.round(result.meanAbsErrorMs)} ms ·{' '}
          {result.bias === 'steady' ? 'steady' : `${result.bias} on average`}
        </span>
      </div>
      <div className="flex flex-wrap gap-1" aria-label="Strokes">
        {result.hits
          .map((h) => ({ t: h.expected, hit: true, err: h.errorMs }))
          .concat(result.misses.map((m) => ({ t: m, hit: false, err: 0 })))
          .sort((a, b) => a.t - b.t)
          .map((s, i) => (
            <span
              key={`${s.t}-${i}`}
              title={s.hit ? `${s.err > 0 ? '+' : ''}${Math.round(s.err)} ms` : 'missed'}
              className={`numeric h-6 min-w-8 rounded-[3px] px-1 text-center text-[9px] leading-6 ${
                !s.hit
                  ? 'bg-danger/35 text-hi'
                  : Math.abs(s.err) <= 50
                    ? 'bg-accent-state text-page'
                    : 'bg-accent-state/45 text-hi'
              }`}
            >
              {s.hit ? `${s.err > 0 ? '+' : ''}${Math.round(s.err)}` : '—'}
            </span>
          ))}
      </div>
    </div>
  );
}
