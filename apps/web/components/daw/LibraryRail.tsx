'use client';

/**
 * LibraryRail (Studio v3) — the left pane, Logic's Library: everything a
 * project can be built from, one click from the arrangement.
 *
 *  • Sounds — the studio's instruments (oud, durbaan, bass, keys) and the
 *    audio track, each with a one-line description, an audition and
 *    "Add track" / "Use on the selected track".
 *  • Loops — the Loop Browser (QaraamiGen model output only), embedded.
 *  • Grooves — the Somali durbaan presets with a 16-step preview, a one-bar
 *    audition at the project tempo, and "Add at playhead".
 *  • Scales — the five pentatonic modes on any root: play the scale, set it
 *    as the project's qaraami scale lock.
 *
 * The rail never touches audio except through engine.audition(); edits go
 * through onUpdate so they land in the history like any other edit.
 */

import { useEffect, useRef, useState } from 'react';
import type { DawEngine } from '@/lib/daw/engine';
import { GROOVE_PRESETS, STEPS_PER_BAR, grooveRegion, type GroovePreset } from '@/lib/daw/grooves';
import { PENTATONIC_MODES, ROOT_NAMES, scalePitchClasses } from '@/lib/daw/scales';
import {
  DURBAAN_LANES,
  INSTRUMENT_LABELS,
  newAudioTrack,
  newTrack,
  trackKind,
  type DawProject,
  type InstrumentId,
  type PentatonicMode,
} from '@/lib/daw/types';
import { LoopBrowser } from './LoopBrowser';
import type { UpdateFn } from './DawApp';

export type LibraryTab = 'sounds' | 'loops' | 'grooves' | 'scales';

export const LIBRARY_TABS: readonly { id: LibraryTab; label: string }[] = [
  { id: 'sounds', label: 'Sounds' },
  { id: 'loops', label: 'Loops' },
  { id: 'grooves', label: 'Grooves' },
  { id: 'scales', label: 'Scales' },
];

interface Patch {
  instrument: InstrumentId;
  somali: string;
  description: string;
  auditionMidi: number;
}

const PATCHES: readonly Patch[] = [
  {
    instrument: 'oud',
    somali: 'kaban',
    description:
      'Plucked-string oud voice: a doubled course a few cents apart, a faint low octave, the Beerdilaacshe sound.',
    auditionMidi: 62,
  },
  {
    instrument: 'durbaan',
    somali: 'durbaan',
    description: 'Frame drum: dum (low), tak (rim) and slap, edited on the 16-step grid.',
    auditionMidi: 36,
  },
  {
    instrument: 'bass',
    somali: 'baas',
    description: 'Round subtractive bass for the low line under the kaban.',
    auditionMidi: 43,
  },
  {
    instrument: 'keys',
    somali: 'biyaano',
    description: 'Soft keys: pads and chords, the band-era organ colour.',
    auditionMidi: 67,
  },
];

export function LibraryRail({
  project,
  engine,
  tab,
  playheadBeat,
  selectedTrackId,
  onTabChange,
  onUpdate,
  onSelectTrack,
  onClose,
  onNotice,
}: {
  project: DawProject;
  engine: DawEngine;
  tab: LibraryTab;
  playheadBeat: number;
  selectedTrackId: string | null;
  onTabChange: (tab: LibraryTab) => void;
  onUpdate: UpdateFn;
  onSelectTrack: (trackId: string) => void;
  onClose: () => void;
  onNotice: (message: string) => void;
}): React.JSX.Element {
  return (
    <aside
      aria-label="Library"
      className="flex h-full w-full flex-col border-r border-hairline bg-chrome-1 md:w-(--studio-library-rail)"
    >
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-hairline px-1.5">
        {LIBRARY_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTabChange(t.id)}
            aria-pressed={tab === t.id}
            className={`numeric h-7 rounded-[3px] px-2 text-[10px] tracking-[0.14em] uppercase transition-colors ${
              tab === t.id ? 'bg-chrome-2 text-accent-state' : 'text-low hover:text-hi'
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the library"
          className="ml-auto h-7 w-7 rounded-[3px] text-sm text-low hover:bg-chrome-2 hover:text-hi"
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'loops' ? (
          <LoopBrowser
            project={project}
            playheadBeat={playheadBeat}
            onUpdate={onUpdate}
            onClose={onClose}
          />
        ) : tab === 'grooves' ? (
          <GroovesTab
            project={project}
            engine={engine}
            playheadBeat={playheadBeat}
            selectedTrackId={selectedTrackId}
            onUpdate={onUpdate}
            onSelectTrack={onSelectTrack}
            onNotice={onNotice}
          />
        ) : tab === 'scales' ? (
          <ScalesTab project={project} engine={engine} onUpdate={onUpdate} onNotice={onNotice} />
        ) : (
          <SoundsTab
            project={project}
            engine={engine}
            selectedTrackId={selectedTrackId}
            onUpdate={onUpdate}
            onSelectTrack={onSelectTrack}
            onNotice={onNotice}
          />
        )}
      </div>
    </aside>
  );
}

// ── Sounds ───────────────────────────────────────────────────────────────────

function SoundsTab({
  project,
  engine,
  selectedTrackId,
  onUpdate,
  onSelectTrack,
  onNotice,
}: {
  project: DawProject;
  engine: DawEngine;
  selectedTrackId: string | null;
  onUpdate: UpdateFn;
  onSelectTrack: (trackId: string) => void;
  onNotice: (message: string) => void;
}): React.JSX.Element {
  const selected = project.tracks.find((t) => t.id === selectedTrackId) ?? null;
  const selectedIsMidi = selected !== null && trackKind(selected) === 'midi';

  const addTrack = (instrument: InstrumentId): void => {
    const count =
      project.tracks.filter((t) => t.instrument === instrument && trackKind(t) === 'midi').length +
      1;
    const track = newTrack(`${INSTRUMENT_LABELS[instrument]} ${count}`, instrument);
    onUpdate((draft) => {
      draft.tracks.push(track);
    });
    onSelectTrack(track.id);
    onNotice(`${INSTRUMENT_LABELS[instrument]} track added`);
  };

  const useOnSelected = (instrument: InstrumentId): void => {
    if (!selected || !selectedIsMidi) return;
    onUpdate((draft) => {
      const t = draft.tracks.find((x) => x.id === selected.id);
      if (t) t.instrument = instrument;
    });
    onNotice(`${selected.name} now plays ${INSTRUMENT_LABELS[instrument]}`);
  };

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-2">
      <p className="numeric px-1 text-[9px] tracking-[0.14em] text-low uppercase">
        Instruments · synthesised in the browser
      </p>
      {PATCHES.map((patch) => (
        <article
          key={patch.instrument}
          className="rounded-[4px] border border-hairline bg-chrome-2 p-2.5"
        >
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-display text-base text-hi">
              {INSTRUMENT_LABELS[patch.instrument]}
            </h3>
            <span className="numeric text-[9px] tracking-[0.14em] text-accent-state uppercase">
              {patch.somali}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-mid">{patch.description}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            <RailButton
              label="Audition"
              onClick={() => {
                engine.unlock();
                engine.audition(patch.instrument, patch.auditionMidi, 0.85);
              }}
            />
            <RailButton label="Add track" accent onClick={() => addTrack(patch.instrument)} />
            {selectedIsMidi && selected.instrument !== patch.instrument ? (
              <RailButton
                label={`Use on ${selected.name}`}
                onClick={() => useOnSelected(patch.instrument)}
              />
            ) : null}
          </div>
        </article>
      ))}
      <article className="rounded-[4px] border border-dashed border-hairline p-2.5">
        <h3 className="font-display text-base text-hi">Audio track</h3>
        <p className="mt-1 text-[11px] leading-snug text-mid">
          Recordings from the microphone, imported files and QaraamiGen loops. Nothing is uploaded;
          audio stays in this browser.
        </p>
        <div className="mt-2">
          <RailButton
            label="Add audio track"
            accent
            onClick={() => {
              const count = project.tracks.filter((t) => trackKind(t) === 'audio').length + 1;
              const track = newAudioTrack(`Audio ${count}`);
              onUpdate((draft) => {
                draft.tracks.push(track);
              });
              onSelectTrack(track.id);
            }}
          />
        </div>
      </article>
    </div>
  );
}

// ── Grooves ──────────────────────────────────────────────────────────────────

function GroovesTab({
  project,
  engine,
  playheadBeat,
  selectedTrackId,
  onUpdate,
  onSelectTrack,
  onNotice,
}: {
  project: DawProject;
  engine: DawEngine;
  playheadBeat: number;
  selectedTrackId: string | null;
  onUpdate: UpdateFn;
  onSelectTrack: (trackId: string) => void;
  onNotice: (message: string) => void;
}): React.JSX.Element {
  const [previewing, setPreviewing] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  const beatsPerBar = project.timeSignature.beatsPerBar;

  const stopPreview = (): void => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    setPreviewing(null);
  };
  useEffect(() => stopPreview, []);

  const preview = (preset: GroovePreset): void => {
    stopPreview();
    engine.unlock();
    const stepSec = ((60 / project.bpm) * beatsPerBar) / STEPS_PER_BAR;
    preset.lanes.forEach((lane, laneIndex) => {
      lane.forEach((velocity, step) => {
        if (velocity <= 0) return;
        const midi = DURBAAN_LANES[laneIndex]?.midi ?? 36;
        timers.current.push(
          window.setTimeout(
            () => engine.audition('durbaan', midi, velocity),
            Math.round(step * stepSec * 1000),
          ),
        );
      });
    });
    timers.current.push(
      window.setTimeout(
        () => setPreviewing(null),
        Math.round(STEPS_PER_BAR * stepSec * 1000) + 300,
      ),
    );
    setPreviewing(preset.id);
  };

  const addAtPlayhead = (preset: GroovePreset): void => {
    const start = Math.max(0, Math.floor(playheadBeat / beatsPerBar) * beatsPerBar);
    const selected = project.tracks.find((t) => t.id === selectedTrackId);
    const target =
      selected && trackKind(selected) === 'midi' && selected.instrument === 'durbaan'
        ? selected
        : (project.tracks.find((t) => trackKind(t) === 'midi' && t.instrument === 'durbaan') ??
          null);
    const region = grooveRegion(preset, start, beatsPerBar, 2);
    if (target) {
      onUpdate((draft) => {
        draft.tracks.find((t) => t.id === target.id)?.regions.push(region);
      });
      onSelectTrack(target.id);
      onNotice(`${preset.label} added to ${target.name} at bar ${start / beatsPerBar + 1}`);
    } else {
      const track = newTrack('Durbaan', 'durbaan');
      track.regions = [region];
      onUpdate((draft) => {
        draft.tracks.push(track);
      });
      onSelectTrack(track.id);
      onNotice(`${preset.label} added on a new durbaan track`);
    }
  };

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-2">
      <p className="numeric px-1 text-[9px] tracking-[0.14em] text-low uppercase">
        Somali grooves · one bar of {beatsPerBar} · {project.bpm} BPM
      </p>
      {GROOVE_PRESETS.map((preset) => (
        <article key={preset.id} className="rounded-[4px] border border-hairline bg-chrome-2 p-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-display text-base text-hi">{preset.label}</h3>
            <span className="numeric text-[9px] tracking-[0.14em] text-low uppercase">
              dum · tak · slap
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-0.5" aria-hidden>
            {preset.lanes.map((lane, laneIndex) => (
              <div key={laneIndex} className="grid grid-cols-16 gap-px">
                {lane.map((velocity, step) => (
                  <span
                    key={step}
                    className={`h-1.5 rounded-[1px] ${
                      velocity <= 0
                        ? step % 4 === 0
                          ? 'bg-hairline'
                          : 'bg-hairline/50'
                        : velocity < 0.6
                          ? 'bg-accent-state/45'
                          : velocity < 0.85
                            ? 'bg-accent-state/75'
                            : 'bg-accent-state'
                    }`}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <RailButton
              label={previewing === preset.id ? '■ Stop' : '▶ Preview'}
              onClick={() => (previewing === preset.id ? stopPreview() : preview(preset))}
            />
            <RailButton label="Add at playhead" accent onClick={() => addAtPlayhead(preset)} />
          </div>
        </article>
      ))}
      <p className="px-1 text-[10px] leading-snug text-low">
        Stylised starting points named after Somali rhythmic families; edit every stroke in the step
        grid once a region is on the timeline.
      </p>
    </div>
  );
}

// ── Scales ───────────────────────────────────────────────────────────────────

function ScalesTab({
  project,
  engine,
  onUpdate,
  onNotice,
}: {
  project: DawProject;
  engine: DawEngine;
  onUpdate: UpdateFn;
  onNotice: (message: string) => void;
}): React.JSX.Element {
  const [root, setRoot] = useState(project.scaleLock.root);
  const timers = useRef<number[]>([]);
  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
    },
    [],
  );

  const play = (mode: PentatonicMode): void => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    engine.unlock();
    const entry = PENTATONIC_MODES.find((m) => m.id === mode);
    if (!entry) return;
    const base = 60 + root; // the root in the C4 octave
    const notes = [...entry.degrees.map((d) => base + d), base + 12];
    notes.forEach((midi, i) => {
      timers.current.push(window.setTimeout(() => engine.audition('oud', midi, 0.85), i * 220));
    });
  };

  const lock = (mode: PentatonicMode): void => {
    onUpdate((draft) => {
      draft.scaleLock = { enabled: true, root, mode };
    });
    const label = PENTATONIC_MODES.find((m) => m.id === mode)?.label ?? mode;
    onNotice(`Scale lock: ${ROOT_NAMES[root] ?? ''} ${label}`);
  };

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="numeric text-[9px] tracking-[0.14em] text-low uppercase">Pentatonic modes</p>
        <label className="numeric flex items-center gap-1 text-[9px] tracking-[0.14em] text-low uppercase">
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
      </div>
      {PENTATONIC_MODES.map((mode) => {
        const active =
          project.scaleLock.enabled &&
          project.scaleLock.mode === mode.id &&
          project.scaleLock.root === root;
        const pcs = [...scalePitchClasses(root, mode.id)];
        const names = mode.degrees.map((d) => ROOT_NAMES[(root + d) % 12] ?? '');
        return (
          <article
            key={mode.id}
            className={`rounded-[4px] border bg-chrome-2 p-2.5 ${
              active ? 'border-accent-state' : 'border-hairline'
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-display text-base text-hi">{mode.label}</h3>
              {active ? (
                <span className="numeric text-[9px] tracking-[0.14em] text-accent-state uppercase">
                  locked
                </span>
              ) : null}
            </div>
            <div className="mt-1.5 flex items-center gap-1" aria-label={`Notes ${names.join(' ')}`}>
              {Array.from({ length: 12 }, (_, pc) => {
                const inScale = pcs.includes(pc);
                const isRoot = pc === root;
                return (
                  <span
                    key={pc}
                    className={`h-5 flex-1 rounded-[2px] text-center text-[9px] leading-5 ${
                      isRoot
                        ? 'bg-accent-state text-page'
                        : inScale
                          ? 'bg-accent-state/35 text-hi'
                          : 'bg-hairline/40 text-low/60'
                    }`}
                  >
                    {inScale ? ROOT_NAMES[pc] : ''}
                  </span>
                );
              })}
            </div>
            <p className="numeric mt-1 text-[9px] tracking-wide text-low">
              degrees {mode.degrees.join(' ')} · {names.join(' ')}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              <RailButton label="▶ Play" onClick={() => play(mode.id)} />
              <RailButton
                label={active ? 'Locked' : 'Use as scale lock'}
                accent={!active}
                onClick={() => lock(mode.id)}
              />
            </div>
          </article>
        );
      })}
      <p className="px-1 text-[10px] leading-snug text-low">
        Qaraami melodies live on the five-note (anhemitonic) pentatonic set; each mode is the same
        five notes heard from a different root. With the lock on, the piano roll, musical typing and
        the play surface stay in scale.
      </p>
    </div>
  );
}

function RailButton({
  label,
  onClick,
  accent = false,
}: {
  label: string;
  onClick: () => void;
  accent?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`numeric h-7 rounded-[3px] border px-2 text-[10px] tracking-[0.08em] uppercase transition-colors ${
        accent
          ? 'border-accent-state/60 text-accent-state hover:bg-accent-state hover:text-page'
          : 'border-hairline text-mid hover:border-accent-state hover:text-hi'
      }`}
    >
      {label}
    </button>
  );
}
