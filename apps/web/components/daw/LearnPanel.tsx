'use client';

/**
 * LearnPanel (Studio v3) — the bottom panel's Learn tab, GarageBand's
 * "Learn to Play" for Somali music:
 *
 *  • Qaamuus — the reverse dictionary over lib/learn/glossary.json: describe
 *    it in English or Somali, get the term, its definition, sources and a
 *    "Hear it" where the studio can play something for it.
 *  • Scale — the pentatonic set and its five modes, with the scale lock.
 *  • Rhythm — the durbaan grooves with a tap trainer (LearnRhythm).
 *  • Melody — Beerdilaacshe phrase by phrase with play-along scoring
 *    (LearnMelody).
 *  • History — Radio Hargeysa and the qaraami era, linked to the glossary.
 *
 * Note and tap events come from DawApp through subscribe functions so the
 * lessons can listen to the keyboard, musical typing, MIDI and the space bar
 * without owning any input of their own.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DawEngine } from '@/lib/daw/engine';
import { PENTATONIC_MODES, ROOT_NAMES } from '@/lib/daw/scales';
import { GROOVE_PRESETS, STEPS_PER_BAR } from '@/lib/daw/grooves';
import { DURBAAN_LANES, type DawProject, type PentatonicMode } from '@/lib/daw/types';
import glossaryJson from '@/lib/learn/glossary.json';
import {
  browse,
  buildIndex,
  relatedEntries,
  searchGlossary,
  type SearchHit,
} from '@/lib/learn/glossarySearch';
import {
  GLOSSARY_CATEGORIES,
  type GlossaryCategory,
  type GlossaryEntry,
  type GlossaryFile,
  type GlossaryListen,
} from '@/lib/learn/glossaryTypes';
import { scheduleAuditions, type AuditionEvent, type Cancel } from '@/lib/learn/audition';
import { HISTORY_LESSON, LESSONS, SCALE_LESSON, type LessonId } from '@/lib/learn/lessons';
import type { UpdateFn } from './DawApp';
import { LearnMelody } from './LearnMelody';
import { LearnRhythm } from './LearnRhythm';

export type LearnTab = LessonId;

export interface NoteEvent {
  type: 'on' | 'off';
  midi: number;
  velocity: number;
  /** performance.now() when the note was played. */
  timeMs: number;
}

const GLOSSARY = glossaryJson as GlossaryFile;
const ENTRIES: GlossaryEntry[] = GLOSSARY.entries;
const CATEGORY_LABELS: Record<GlossaryCategory, string> = {
  genre: 'Genres',
  form: 'Song forms',
  poetry: 'Poetry',
  dance: 'Dance',
  ritual: 'Ritual & devotion',
  instrument: 'Instruments',
  performance: 'Performance',
  theory: 'Musical terms',
  rhythm: 'Rhythm',
  people: 'People',
  institution: 'Institutions',
  production: 'Recording & archive',
};

export function LearnPanel({
  project,
  engine,
  tab,
  onTabChange,
  onUpdate,
  onNotice,
  onOpenPlay,
  subscribeNotes,
  subscribeTaps,
}: {
  project: DawProject;
  engine: DawEngine;
  tab: LearnTab;
  onTabChange: (tab: LearnTab) => void;
  onUpdate: UpdateFn;
  onNotice: (message: string) => void;
  onOpenPlay: () => void;
  subscribeNotes: (listener: (ev: NoteEvent) => void) => () => void;
  subscribeTaps: (listener: (timeMs: number) => void) => () => void;
}): React.JSX.Element {
  const [focusEntry, setFocusEntry] = useState<string | null>(null);
  const openEntry = (id: string): void => {
    setFocusEntry(id);
    onTabChange('qaamuus');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-hairline px-2">
        {LESSONS.map((lesson) => (
          <button
            key={lesson.id}
            type="button"
            onClick={() => onTabChange(lesson.id)}
            aria-pressed={tab === lesson.id}
            title={lesson.summary}
            className={`numeric h-6 shrink-0 rounded-[3px] px-2 text-[10px] tracking-[0.12em] uppercase transition-colors ${
              tab === lesson.id ? 'bg-chrome-2 text-accent-state' : 'text-low hover:text-hi'
            }`}
          >
            {lesson.id === 'qaamuus' ? 'Qaamuus' : lesson.title.split(' — ')[0]}
          </button>
        ))}
        <span className="numeric ml-auto hidden text-[9px] text-low lg:block">
          {LESSONS.find((l) => l.id === tab)?.somali} · ~
          {LESSONS.find((l) => l.id === tab)?.minutes} min
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'qaamuus' ? (
          <Qaamuus
            engine={engine}
            project={project}
            focusEntry={focusEntry}
            onFocusEntry={setFocusEntry}
            onUpdate={onUpdate}
            onNotice={onNotice}
          />
        ) : tab === 'scale' ? (
          <ScaleLesson
            engine={engine}
            project={project}
            onUpdate={onUpdate}
            onNotice={onNotice}
            onOpenPlay={onOpenPlay}
          />
        ) : tab === 'rhythm' ? (
          <LearnRhythm
            project={project}
            engine={engine}
            subscribeNotes={subscribeNotes}
            subscribeTaps={subscribeTaps}
          />
        ) : tab === 'melody' ? (
          <LearnMelody engine={engine} subscribeNotes={subscribeNotes} onOpenPlay={onOpenPlay} />
        ) : (
          <HistoryLesson onOpenEntry={openEntry} />
        )}
      </div>
    </div>
  );
}

// ── Qaamuus (reverse dictionary) ─────────────────────────────────────────────

function useListen(engine: DawEngine): {
  play: (l: GlossaryListen, project: DawProject) => void;
  playing: string | null;
  stop: () => void;
} {
  const [playing, setPlaying] = useState<string | null>(null);
  const cancelRef = useRef<Cancel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stop = (): void => {
    cancelRef.current?.();
    cancelRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlaying(null);
  };
  useEffect(() => stop, []);
  const play = (l: GlossaryListen, project: DawProject): void => {
    stop();
    const key = JSON.stringify(l);
    if (l.kind === 'clip') {
      if (!l.url.startsWith('/demos/')) return; // model output only (lib/daw/loops rule)
      const el = new Audio(l.url);
      el.onended = () => setPlaying(null);
      el.onerror = () => setPlaying(null);
      audioRef.current = el;
      void el.play().catch(() => setPlaying(null));
      setPlaying(key);
      return;
    }
    const events: AuditionEvent[] = [];
    let doneMs = 0;
    if (l.kind === 'scale') {
      const entry = PENTATONIC_MODES.find((m) => m.id === l.mode);
      const root = l.root ?? project.scaleLock.root;
      const base = 60 + root;
      [...(entry?.degrees ?? []).map((d) => base + d), base + 12].forEach((midi, i) => {
        events.push({ atMs: i * 220, instrument: 'oud', midi, velocity: 0.85 });
      });
      doneMs = events.length * 220 + 600;
    } else {
      const preset = GROOVE_PRESETS.find((p) => p.id === l.presetId);
      if (!preset) return;
      const stepMs = ((60000 / project.bpm) * project.timeSignature.beatsPerBar) / STEPS_PER_BAR;
      for (let bar = 0; bar < 2; bar++) {
        preset.lanes.forEach((lane, laneIndex) => {
          lane.forEach((v, step) => {
            if (v > 0) {
              events.push({
                atMs: (bar * STEPS_PER_BAR + step) * stepMs,
                instrument: 'durbaan',
                midi: DURBAAN_LANES[laneIndex]?.midi ?? 36,
                velocity: v,
              });
            }
          });
        });
      }
      doneMs = 2 * STEPS_PER_BAR * stepMs + 300;
    }
    cancelRef.current = scheduleAuditions(engine, events, () => setPlaying(null), doneMs);
    setPlaying(key);
  };
  return { play, playing, stop };
}

function Qaamuus({
  engine,
  project,
  focusEntry,
  onFocusEntry,
  onUpdate,
  onNotice,
}: {
  engine: DawEngine;
  project: DawProject;
  focusEntry: string | null;
  onFocusEntry: (id: string | null) => void;
  onUpdate: UpdateFn;
  onNotice: (message: string) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<GlossaryCategory | 'all'>('all');
  const index = useMemo(() => buildIndex(ENTRIES), []);
  const hits: SearchHit[] = useMemo(
    () => (query.trim() ? searchGlossary(index, query, { limit: 30, category }) : []),
    [index, query, category],
  );
  const listing = useMemo(() => browse(ENTRIES, category), [category]);
  const listen = useListen(engine);
  const focused = focusEntry ? (ENTRIES.find((e) => e.id === focusEntry) ?? null) : null;
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) detailRef.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);

  const shown: GlossaryEntry[] = query.trim() ? hits.map((h) => h.entry) : listing;
  const confidenceLabel: Record<GlossaryEntry['confidence'], string> = {
    attested: 'sourced',
    reported: 'reported',
    uncertain: 'unverified',
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3 lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:max-w-md">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            onFocusEntry(null);
          }}
          placeholder="Describe it in English or Somali — “the lute”, “women’s wedding poetry”, “heesaa”…"
          aria-label="Search the glossary by meaning"
          className="h-9 rounded-[4px] border border-hairline bg-chrome-2 px-3 text-sm text-hi placeholder:text-low focus:border-accent-state focus:outline-none"
        />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Category">
          {(['all', ...GLOSSARY_CATEGORIES] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={`numeric h-6 rounded-[3px] border px-1.5 text-[9px] tracking-[0.1em] uppercase transition-colors ${
                category === c
                  ? 'border-accent-state text-accent-state'
                  : 'border-hairline text-low hover:text-hi'
              }`}
            >
              {c === 'all' ? `All ${ENTRIES.length}` : CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
        <ul
          className="min-h-0 flex-1 overflow-auto rounded-[4px] border border-hairline"
          aria-label="Terms"
        >
          {shown.length === 0 ? (
            <li className="p-3 text-[11px] text-low">
              No term matches “{query}”. Try another word, or browse a category.
            </li>
          ) : (
            shown.map((entry) => {
              const hit = hits.find((h) => h.entry.id === entry.id);
              const active = focused?.id === entry.id;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => onFocusEntry(entry.id)}
                    aria-pressed={active}
                    className={`flex w-full items-baseline gap-2 border-b border-hairline/60 px-3 py-1.5 text-left transition-colors hover:bg-chrome-2 ${
                      active ? 'bg-chrome-2' : ''
                    }`}
                  >
                    <span className="font-display text-[15px] text-hi">{entry.term}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-mid">
                      {entry.english}
                    </span>
                    <span className="numeric shrink-0 text-[8px] tracking-[0.12em] text-low uppercase">
                      {hit && hit.matchedFields[0] && hit.matchedFields[0] !== 'term'
                        ? `via ${hit.matchedFields[0]}`
                        : CATEGORY_LABELS[entry.category]}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
      <div
        ref={detailRef}
        className="min-h-0 flex-1 overflow-auto rounded-[4px] border border-hairline bg-chrome-2 p-4"
      >
        {focused ? (
          <article className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="font-display text-2xl text-hi">{focused.term}</h3>
              <span className="text-sm text-mid">{focused.english}</span>
              <span className="numeric rounded-[3px] border border-hairline px-1.5 py-0.5 text-[8px] tracking-[0.12em] text-low uppercase">
                {CATEGORY_LABELS[focused.category]}
              </span>
              <span
                className={`numeric rounded-[3px] px-1.5 py-0.5 text-[8px] tracking-[0.12em] uppercase ${
                  focused.confidence === 'attested'
                    ? 'bg-accent-state/20 text-accent-state'
                    : focused.confidence === 'reported'
                      ? 'bg-hairline text-mid'
                      : 'bg-danger/20 text-danger'
                }`}
                title="attested = in a cited scholarly or primary source · reported = secondary sources · unverified = not yet checked"
              >
                {confidenceLabel[focused.confidence]}
              </span>
            </div>
            {focused.variants.length > 0 ? (
              <p className="numeric text-[10px] tracking-wide text-low">
                also: {focused.variants.join(' · ')}
              </p>
            ) : null}
            <p className="text-[13px] leading-relaxed text-hi">{focused.definition}</p>
            {focused.definitionSo ? (
              <p className="text-[12px] leading-relaxed text-mid italic">{focused.definitionSo}</p>
            ) : null}
            {focused.etymology ? (
              <p className="text-[11px] leading-snug text-mid">
                <span className="numeric text-[9px] tracking-[0.12em] text-low uppercase">
                  etymology ·{' '}
                </span>
                {focused.etymology}
              </p>
            ) : null}
            {focused.listen ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    listen.playing === JSON.stringify(focused.listen)
                      ? listen.stop()
                      : focused.listen && listen.play(focused.listen, project)
                  }
                  className="numeric h-8 rounded-[3px] border border-accent-state/60 px-3 text-[10px] tracking-[0.1em] text-accent-state uppercase hover:bg-accent-state hover:text-page"
                >
                  {listen.playing === JSON.stringify(focused.listen) ? '■ Stop' : '▶ Hear it'}
                </button>
                <span className="numeric text-[9px] tracking-wide text-low">
                  {focused.listen.kind === 'clip'
                    ? 'AI model output from the gallery — generated, not a recording'
                    : focused.listen.kind === 'groove'
                      ? 'studio durbaan preset, two bars at the project tempo'
                      : 'studio oud voice'}
                </span>
                {focused.listen.kind === 'scale' ? (
                  <button
                    type="button"
                    onClick={() => {
                      const l = focused.listen;
                      if (!l || l.kind !== 'scale') return;
                      const mode: PentatonicMode = l.mode;
                      onUpdate((draft) => {
                        draft.scaleLock = {
                          enabled: true,
                          root: l.root ?? draft.scaleLock.root,
                          mode,
                        };
                      });
                      onNotice('Scale lock set from the glossary');
                    }}
                    className="numeric h-8 rounded-[3px] border border-hairline px-2 text-[10px] tracking-[0.1em] text-mid uppercase hover:border-accent-state hover:text-hi"
                  >
                    Use as scale lock
                  </button>
                ) : null}
              </div>
            ) : null}
            {focused.related.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1">
                <span className="numeric text-[9px] tracking-[0.12em] text-low uppercase">
                  see also
                </span>
                {relatedEntries(focused, ENTRIES).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onFocusEntry(r.id)}
                    className="h-6 rounded-[3px] border border-hairline px-1.5 text-[11px] text-mid hover:border-accent-state hover:text-hi"
                  >
                    {r.term}
                  </button>
                ))}
              </div>
            ) : null}
            {focused.sources.length > 0 ? (
              <div className="mt-1 border-t border-hairline pt-2">
                <p className="numeric text-[9px] tracking-[0.12em] text-low uppercase">sources</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {focused.sources.map((s) => (
                    <li key={s} className="text-[11px] leading-snug text-mid">
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-1 border-t border-hairline pt-2 text-[11px] text-danger">
                No source yet — this entry is marked unverified and is not in the published
                dataset’s attested set.
              </p>
            )}
          </article>
        ) : (
          <div className="flex h-full flex-col justify-center gap-2 text-center">
            <p className="font-display text-xl text-hi">Qaamuuska fanka Soomaaliyeed</p>
            <p className="mx-auto max-w-md text-[12px] leading-relaxed text-mid">
              A reverse dictionary of Somali music: {ENTRIES.length} terms with definitions, sources
              and, where the studio can play it, a sound. Type a description in either language, or
              browse a category, then pick a term.
            </p>
            <p className="numeric text-[9px] tracking-[0.14em] text-low uppercase">
              {ENTRIES.filter((e) => e.confidence === 'attested').length} sourced ·{' '}
              {ENTRIES.filter((e) => e.confidence === 'reported').length} reported ·{' '}
              {ENTRIES.filter((e) => e.confidence === 'uncertain').length} unverified ·{' '}
              {GLOSSARY.license} · v{GLOSSARY.version}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Scale lesson ─────────────────────────────────────────────────────────────

function ScaleLesson({
  engine,
  project,
  onUpdate,
  onNotice,
  onOpenPlay,
}: {
  engine: DawEngine;
  project: DawProject;
  onUpdate: UpdateFn;
  onNotice: (message: string) => void;
  onOpenPlay: () => void;
}): React.JSX.Element {
  const [root, setRoot] = useState(project.scaleLock.root);
  const cancelRef = useRef<Cancel | null>(null);
  useEffect(() => () => cancelRef.current?.(), []);
  const play = (mode: PentatonicMode): void => {
    cancelRef.current?.();
    const entry = PENTATONIC_MODES.find((m) => m.id === mode);
    if (!entry) return;
    const base = 60 + root;
    const events: AuditionEvent[] = [...entry.degrees.map((d) => base + d), base + 12].map(
      (midi, i) => ({
        atMs: i * 220,
        instrument: 'oud',
        midi,
        velocity: 0.85,
      }),
    );
    cancelRef.current = scheduleAuditions(engine, events);
  };
  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3 lg:flex-row">
      <div className="flex max-w-md flex-col gap-3">
        <p className="text-[12px] leading-snug text-mid">{SCALE_LESSON.intro}</p>
        <ol className="flex flex-col gap-1.5 pl-4 text-[11px] leading-snug text-mid">
          {SCALE_LESSON.steps.map((s) => (
            <li key={s} className="list-decimal">
              {s}
            </li>
          ))}
        </ol>
        <p className="text-[11px] leading-snug text-low">{SCALE_LESSON.note}</p>
        <button
          type="button"
          onClick={onOpenPlay}
          className="numeric h-8 w-fit rounded-[3px] border border-hairline px-2 text-[10px] tracking-[0.1em] text-mid uppercase hover:border-accent-state hover:text-hi"
        >
          Open the play surface
        </button>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <label className="numeric flex items-center gap-2 text-[9px] tracking-[0.14em] text-low uppercase">
          Root
          <select
            value={root}
            onChange={(e) => setRoot(Number(e.target.value))}
            aria-label="Scale root"
            className="numeric h-7 rounded-[3px] border border-hairline bg-chrome-2 px-1 text-[11px] text-hi outline-none focus:border-accent-state"
          >
            {ROOT_NAMES.map((name, pc) => (
              <option key={name} value={pc}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {PENTATONIC_MODES.map((mode) => {
          const active =
            project.scaleLock.enabled &&
            project.scaleLock.mode === mode.id &&
            project.scaleLock.root === root;
          const names = mode.degrees.map((d) => ROOT_NAMES[(root + d) % 12] ?? '');
          return (
            <div
              key={mode.id}
              className={`flex flex-wrap items-center gap-2 rounded-[4px] border bg-chrome-2 px-3 py-2 ${active ? 'border-accent-state' : 'border-hairline'}`}
            >
              <span className="w-44 font-display text-[15px] text-hi">{mode.label}</span>
              <span className="numeric flex-1 text-[11px] text-mid">{names.join('  ')}</span>
              <button
                type="button"
                onClick={() => play(mode.id)}
                className="numeric h-7 rounded-[3px] border border-hairline px-2 text-[10px] tracking-[0.08em] text-mid uppercase hover:border-accent-state hover:text-hi"
              >
                ▶ Play
              </button>
              <button
                type="button"
                onClick={() => {
                  onUpdate((draft) => {
                    draft.scaleLock = { enabled: true, root, mode: mode.id };
                  });
                  onNotice(`Scale lock: ${ROOT_NAMES[root] ?? ''} ${mode.label}`);
                }}
                className={`numeric h-7 rounded-[3px] border px-2 text-[10px] tracking-[0.08em] uppercase ${
                  active
                    ? 'border-accent-state bg-accent-state/15 text-accent-state'
                    : 'border-accent-state/60 text-accent-state hover:bg-accent-state hover:text-page'
                }`}
              >
                {active ? 'Locked' : 'Lock'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── History lesson ───────────────────────────────────────────────────────────

function HistoryLesson({ onOpenEntry }: { onOpenEntry: (id: string) => void }): React.JSX.Element {
  const byId = useMemo(() => new Map(ENTRIES.map((e) => [e.id, e])), []);
  return (
    <div className="h-full overflow-auto p-3">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {HISTORY_LESSON.map((p) => (
          <section key={p.heading} className="flex flex-col gap-1.5">
            <h3 className="font-display text-lg text-hi">{p.heading}</h3>
            <p className="text-[13px] leading-relaxed text-mid">{p.text}</p>
            <div className="flex flex-wrap gap-1">
              {p.glossary.map((id) => {
                const e = byId.get(id);
                return e ? (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onOpenEntry(id)}
                    className="h-6 rounded-[3px] border border-hairline px-1.5 text-[11px] text-accent-state hover:border-accent-state"
                  >
                    {e.term}
                  </button>
                ) : null;
              })}
            </div>
          </section>
        ))}
        <p className="border-t border-hairline pt-3 text-[11px] leading-snug text-low">
          Sources are listed on each glossary entry (Johnson 1996, Kapteijns 1999, Andrzejewski
          &amp; Lewis 1964, Banti &amp; Giannattasio 1996 and the others). Dates and attributions
          marked “reported” rest on secondary sources and are flagged for review by the archive’s
          musicologists.
        </p>
      </div>
    </div>
  );
}
