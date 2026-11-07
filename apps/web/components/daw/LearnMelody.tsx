'use client';

/**
 * LearnMelody (Studio v3) — learn Beerdilaacshe phrase by phrase, the way
 * GarageBand's lessons teach a song: listen slowed down, loop it, play along
 * after a count-in, and see how close you were (lib/learn/practiceScore).
 * The melody comes from the engraved score's notes.json and is performed by
 * the studio's own oud voice; nothing here is a recording.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DawEngine } from '@/lib/daw/engine';
import type { ScoreData } from '@/lib/audio/qaraamiEngine';
import { midiName } from '@/lib/daw/scales';
import {
  countInEvents,
  scheduleAuditions,
  type AuditionEvent,
  type Cancel,
} from '@/lib/learn/audition';
import { MELODY_LESSON } from '@/lib/learn/lessons';
import { splitIntoPhrases, type Phrase } from '@/lib/learn/phrases';
import {
  estimateOffset,
  scorePractice,
  type PlayedNote,
  type PracticeScore,
  type RefNote,
} from '@/lib/learn/practiceScore';
import type { NoteEvent } from './LearnPanel';

const SPEEDS = [0.5, 0.75, 1] as const;
const BEATS_PER_BAR = 4;

type Phase =
  | { kind: 'idle' }
  | { kind: 'listening' }
  | { kind: 'countin' }
  | { kind: 'playing' }
  | { kind: 'result'; score: PracticeScore };

function toRefNotes(score: ScoreData): { notes: RefNote[]; bpm: number } {
  const bpm = Math.min(140, Math.max(60, Math.round(score.bpm)));
  const beatsPerSec = bpm / 60;
  return {
    bpm,
    notes: score.notes.map((n) => ({
      startBeat: n.start * beatsPerSec,
      lengthBeats: Math.max(0.1, (n.end - n.start) * beatsPerSec),
      midi: n.midi,
    })),
  };
}

function phraseEvents(
  phrase: Phrase,
  bpm: number,
  speed: number,
  startMs: number,
  velocity: number,
): AuditionEvent[] {
  const beatMs = 60000 / (bpm * speed);
  return phrase.notes.map((n) => ({
    atMs: startMs + (n.startBeat - phrase.startBeat) * beatMs,
    instrument: 'oud',
    midi: n.midi,
    velocity,
  }));
}

export function LearnMelody({
  engine,
  subscribeNotes,
  onOpenPlay,
}: {
  engine: DawEngine;
  subscribeNotes: (listener: (ev: NoteEvent) => void) => () => void;
  onOpenPlay: () => void;
}): React.JSX.Element {
  const [score, setScore] = useState<{ notes: RefNote[]; bpm: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [speed, setSpeed] = useState<number>(0.75);
  const [loop, setLoop] = useState(true);
  const [guide, setGuide] = useState(true);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const cancelRef = useRef<Cancel | null>(null);
  const captureRef = useRef<{
    startMs: number;
    beatMs: number;
    held: Map<number, { startBeat: number; velocity: number }>;
    notes: PlayedNote[];
  } | null>(null);
  const loopRef = useRef(loop);
  loopRef.current = loop;

  useEffect(() => {
    let cancelled = false;
    fetch('/scores/beerdilaacshe/notes.json')
      .then((r) =>
        r.ok ? (r.json() as Promise<ScoreData>) : Promise.reject(new Error(String(r.status))),
      )
      .then((data) => {
        if (!cancelled) setScore(toRefNotes(data));
      })
      .catch(() => {
        if (!cancelled) setError('The score could not be loaded.');
      });
    return () => {
      cancelled = true;
      cancelRef.current?.();
    };
  }, []);

  const phrases = useMemo(
    () => (score ? splitIntoPhrases(score.notes, BEATS_PER_BAR, { barsPerPhrase: 2 }) : []),
    [score],
  );
  const whole: Phrase | null = useMemo(() => {
    if (!score || phrases.length === 0) return null;
    const last = phrases[phrases.length - 1];
    return last
      ? {
          index: phrases.length,
          startBeat: 0,
          endBeat: last.endBeat,
          notes: score.notes,
          label: 'Whole melody',
        }
      : null;
  }, [score, phrases]);
  const items = whole ? [...phrases, whole] : phrases;
  const phrase = items[Math.min(phraseIndex, Math.max(0, items.length - 1))] ?? null;

  const stop = useCallback((): void => {
    cancelRef.current?.();
    cancelRef.current = null;
    captureRef.current = null;
    setPhase({ kind: 'idle' });
  }, []);

  const listen = useCallback((): void => {
    if (!phrase || !score) return;
    cancelRef.current?.();
    const beatMs = 60000 / (score.bpm * speed);
    const lengthMs = (phrase.endBeat - phrase.startBeat) * beatMs;
    const run = (): void => {
      cancelRef.current = scheduleAuditions(
        engine,
        phraseEvents(phrase, score.bpm, speed, 0, 0.85),
        () => {
          if (loopRef.current) run();
          else setPhase({ kind: 'idle' });
        },
        lengthMs + 150,
      );
    };
    run();
    setPhase({ kind: 'listening' });
  }, [engine, phrase, score, speed]);

  const playAlong = (): void => {
    if (!phrase || !score) return;
    cancelRef.current?.();
    const beatMs = 60000 / (score.bpm * speed);
    const countMs = BEATS_PER_BAR * beatMs;
    const lengthMs = (phrase.endBeat - phrase.startBeat) * beatMs;
    const t0 = performance.now();
    captureRef.current = { startMs: t0 + countMs, beatMs, held: new Map(), notes: [] };
    const events = [
      ...countInEvents(score.bpm * speed, BEATS_PER_BAR, 0),
      ...(guide ? phraseEvents(phrase, score.bpm, speed, countMs, 0.35) : []),
    ];
    cancelRef.current = scheduleAuditions(
      engine,
      events,
      () => {
        const cap = captureRef.current;
        captureRef.current = null;
        if (!cap) return;
        const now = performance.now();
        for (const [midi, h] of cap.held) {
          cap.notes.push({
            midi,
            velocity: h.velocity,
            startBeat: h.startBeat,
            endBeat: (now - cap.startMs) / cap.beatMs,
          });
        }
        const reference = phrase.notes.map((n) => ({
          ...n,
          startBeat: n.startBeat - phrase.startBeat,
        }));
        const offset = estimateOffset(reference, cap.notes);
        const result = scorePractice(reference, cap.notes, {
          offsetBeats: Math.abs(offset) <= 1 ? offset : 0,
        });
        setPhase({ kind: 'result', score: result });
      },
      countMs + lengthMs + 400,
    );
    setPhase({ kind: 'countin' });
    window.setTimeout(
      () => setPhase((p) => (p.kind === 'countin' ? { kind: 'playing' } : p)),
      countMs,
    );
  };

  useEffect(
    () =>
      subscribeNotes((ev) => {
        const cap = captureRef.current;
        if (!cap) return;
        const beat = (ev.timeMs - cap.startMs) / cap.beatMs;
        if (ev.type === 'on') cap.held.set(ev.midi, { startBeat: beat, velocity: ev.velocity });
        else {
          const h = cap.held.get(ev.midi);
          if (h) {
            cap.held.delete(ev.midi);
            cap.notes.push({
              midi: ev.midi,
              velocity: h.velocity,
              startBeat: h.startBeat,
              endBeat: Math.max(beat, h.startBeat + 0.05),
            });
          }
        }
      }),
    [subscribeNotes],
  );

  const busy = phase.kind !== 'idle' && phase.kind !== 'result';
  const chip = (active: boolean): string =>
    `numeric h-7 rounded-[3px] border px-2 text-[10px] tracking-[0.08em] uppercase transition-colors ${
      active
        ? 'border-accent-state bg-accent-state/15 text-accent-state'
        : 'border-hairline text-low hover:text-hi'
    }`;

  if (error) return <p className="p-4 text-sm text-danger">{error}</p>;
  if (!score || !phrase)
    return (
      <p className="numeric p-4 text-[10px] tracking-[0.2em] text-low uppercase">
        Loading the score…
      </p>
    );

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3 lg:flex-row">
      <div className="flex max-w-md flex-col gap-3">
        <p className="text-[12px] leading-snug text-mid">{MELODY_LESSON.intro}</p>
        <ol className="flex flex-col gap-1.5 pl-4 text-[11px] leading-snug text-mid">
          {MELODY_LESSON.steps.map((s) => (
            <li key={s} className="list-decimal">
              {s}
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={onOpenPlay}
          className="numeric h-8 w-fit rounded-[3px] border border-hairline px-2 text-[10px] tracking-[0.1em] text-mid uppercase hover:border-accent-state hover:text-hi"
        >
          Open the play surface
        </button>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="numeric text-[9px] tracking-[0.14em] text-low uppercase">Phrase</span>
          {items.map((p, i) => (
            <button
              key={p.label}
              type="button"
              aria-pressed={i === phraseIndex}
              onClick={() => {
                stop();
                setPhraseIndex(i);
              }}
              className={chip(i === phraseIndex)}
            >
              {p === whole ? 'All' : String(i + 1)}
            </button>
          ))}
          <span className="numeric ml-1 text-[10px] text-low">
            bars {Math.floor(phrase.startBeat / BEATS_PER_BAR) + 1}–
            {Math.ceil(phrase.endBeat / BEATS_PER_BAR)} · {phrase.notes.length} notes · {score.bpm}{' '}
            BPM
          </span>
        </div>

        <PhraseStrip phrase={phrase} />

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="numeric text-[9px] tracking-[0.14em] text-low uppercase">Speed</span>
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={speed === s}
              onClick={() => setSpeed(s)}
              className={chip(speed === s)}
            >
              {Math.round(s * 100)}%
            </button>
          ))}
          <button
            type="button"
            aria-pressed={loop}
            onClick={() => setLoop((v) => !v)}
            className={chip(loop)}
          >
            Loop
          </button>
          <button
            type="button"
            aria-pressed={guide}
            onClick={() => setGuide((v) => !v)}
            className={chip(guide)}
            title="Hear the melody softly while you play"
          >
            Guide
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={phase.kind === 'listening' ? stop : listen}
            className="numeric h-9 rounded-[4px] border border-hairline px-3 text-[11px] tracking-[0.1em] text-hi uppercase hover:border-accent-state"
          >
            {phase.kind === 'listening' ? '■ Stop' : '▶ Listen'}
          </button>
          <button
            type="button"
            onClick={busy && phase.kind !== 'listening' ? stop : playAlong}
            className="numeric h-9 rounded-[4px] bg-accent-state px-3 text-[11px] font-semibold tracking-[0.1em] text-page uppercase hover:brightness-110"
          >
            {phase.kind === 'countin' || phase.kind === 'playing' ? '■ Stop' : 'Play along'}
          </button>
          <span className="numeric text-[10px] text-low">
            {phase.kind === 'countin'
              ? 'count-in…'
              : phase.kind === 'playing'
                ? 'play!'
                : phase.kind === 'listening'
                  ? 'listening'
                  : 'keyboard, typing (⌘K) or MIDI'}
          </span>
        </div>

        {phase.kind === 'result' ? (
          <PracticeResultView
            score={phase.score}
            onNext={phraseIndex < items.length - 1 ? () => setPhraseIndex((i) => i + 1) : null}
          />
        ) : null}
      </div>
    </div>
  );
}

function PhraseStrip({ phrase }: { phrase: Phrase }): React.JSX.Element {
  const span = Math.max(1, phrase.endBeat - phrase.startBeat);
  const midis = phrase.notes.map((n) => n.midi);
  const lo = Math.min(...midis, 60);
  const hi = Math.max(...midis, 72);
  const rows = hi - lo + 1;
  return (
    <div
      className="relative h-24 w-full overflow-hidden rounded-[4px] border border-hairline bg-chrome-2"
      aria-label="Phrase notes"
    >
      {phrase.notes.map((n, i) => (
        <span
          key={i}
          title={midiName(n.midi)}
          className="absolute rounded-[1px] bg-accent-state"
          style={{
            left: `${((n.startBeat - phrase.startBeat) / span) * 100}%`,
            width: `${Math.max(0.8, (n.lengthBeats / span) * 100 - 0.4)}%`,
            top: `${((hi - n.midi) / rows) * 100}%`,
            height: `${100 / rows}%`,
          }}
        />
      ))}
    </div>
  );
}

function PracticeResultView({
  score,
  onNext,
}: {
  score: PracticeScore;
  onNext: (() => void) | null;
}): React.JSX.Element {
  return (
    <div
      className="flex flex-col gap-2 rounded-[4px] border border-hairline bg-chrome-2 p-3"
      role="status"
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-display text-3xl text-hi">{score.overall}</span>
        <span className="numeric text-[10px] tracking-[0.14em] text-accent-state uppercase">
          {score.verdict.replace('-', ' ')}
        </span>
        <span className="numeric text-[10px] text-mid">
          pitch {Math.round(score.pitchAccuracy * 100)}% · timing{' '}
          {Math.round(score.timingAccuracy * 100)}% · {Math.round(score.completeness * 100)}% of the
          notes · {score.extras.length} extra ·{' '}
          {score.meanOffsetBeats > 0.05
            ? 'a little late'
            : score.meanOffsetBeats < -0.05
              ? 'a little early'
              : 'in time'}
        </span>
        {onNext ? (
          <button
            type="button"
            onClick={onNext}
            className="numeric ml-auto h-7 rounded-[3px] border border-accent-state/60 px-2 text-[10px] tracking-[0.1em] text-accent-state uppercase hover:bg-accent-state hover:text-page"
          >
            Next phrase →
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1" aria-label="Notes">
        {score.matches.map((m, i) => (
          <span
            key={i}
            title={
              m.played
                ? `${midiName(m.ref.midi)} · ${m.deltaBeats !== null && m.deltaBeats > 0 ? '+' : ''}${m.deltaBeats?.toFixed(2) ?? ''} beats`
                : `${midiName(m.ref.midi)} missed`
            }
            className={`numeric h-6 min-w-8 rounded-[3px] px-1 text-center text-[9px] leading-6 ${
              !m.played
                ? 'bg-danger/35 text-hi'
                : m.pitchOk && Math.abs(m.deltaBeats ?? 1) <= 0.25
                  ? 'bg-accent-state text-page'
                  : m.pitchOk
                    ? 'bg-accent-state/45 text-hi'
                    : 'bg-danger/60 text-hi'
            }`}
          >
            {midiName(m.ref.midi)}
          </span>
        ))}
      </div>
    </div>
  );
}
