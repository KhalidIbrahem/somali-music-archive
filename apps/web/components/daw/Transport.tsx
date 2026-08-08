'use client';

/**
 * Transport (Stage 5 Tier 1) — play/stop, record-arm indicator, position,
 * BPM (60–140), time signature, metronome + count-in, loop toggle, scale
 * lock, project name, save state, open + WAV export. Two-row wrap on narrow
 * screens; every control is a ≥40px touch target on mobile.
 */

import { useState } from 'react';
import Link from 'next/link';
import type { DawEngine, EngineSnapshot } from '@/lib/daw/engine';
import { BPM_MAX, BPM_MIN, type DawProject } from '@/lib/daw/types';
import { PENTATONIC_MODES, ROOT_NAMES } from '@/lib/daw/scales';

export function Transport({
  project,
  engine,
  transport,
  saveState,
  exporting,
  onUpdate,
  onExport,
  onOpen,
}: {
  project: DawProject;
  engine: DawEngine;
  transport: EngineSnapshot;
  saveState: 'saved' | 'saving' | 'offline';
  exporting: boolean;
  onUpdate: (mutate: (draft: DawProject) => void) => void;
  onExport: () => void;
  onOpen: () => void;
}): React.JSX.Element {
  const [editingName, setEditingName] = useState(false);
  const playing = transport.state !== 'stopped';
  const beatsPerBar = project.timeSignature.beatsPerBar;
  const bar = Math.floor(transport.beat / beatsPerBar) + 1;
  const beatInBar = Math.floor(transport.beat % beatsPerBar) + 1;

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline bg-chrome-1 px-3 py-2">
      <Link
        href="/account"
        className="numeric hidden text-[11px] tracking-[0.14em] text-low uppercase transition-colors hover:text-accent-state sm:block"
      >
        ← Dashboard
      </Link>

      {/* name + save state */}
      {editingName ? (
        <input
          defaultValue={project.name}
          autoFocus
          maxLength={80}
          aria-label="Project name"
          onBlur={(e) => {
            const value = e.target.value.trim() || 'Untitled';
            onUpdate((draft) => {
              draft.name = value;
            });
            setEditingName(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className="w-40 rounded-[4px] border border-hairline bg-chrome-2 px-2 py-1 text-sm text-hi outline-none focus:border-accent-state"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditingName(true)}
          className="max-w-40 truncate text-sm font-semibold text-hi hover:text-accent-state"
          title="Rename project"
        >
          {project.name}
        </button>
      )}
      <span
        className={`numeric text-[10px] tracking-[0.14em] uppercase ${
          saveState === 'offline' ? 'text-danger' : 'text-low'
        }`}
      >
        {saveState === 'saving' ? 'saving…' : saveState === 'offline' ? 'offline copy' : 'saved'}
      </span>

      {/* play / stop / arm-indicator */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={playing ? 'Stop' : 'Play'}
          onClick={() => (playing ? engine.stop() : engine.play(transport.beat))}
          className={`flex h-10 w-12 items-center justify-center rounded-[4px] text-page transition-colors ${
            playing ? 'bg-accent-live' : 'bg-accent-state'
          }`}
        >
          {playing ? (
            <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
              <rect x="1.5" y="1.5" width="9" height="9" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
              <path d="M2.5 1.2v9.6L11 6 2.5 1.2Z" />
            </svg>
          )}
        </button>
        <span className="numeric w-20 text-center text-sm text-hi" aria-label="Position">
          {bar}.{beatInBar}
          <span className="text-low"> {transport.state === 'counting' ? '· count' : ''}</span>
        </span>
      </div>

      {/* bpm + time signature */}
      <label className="flex items-center gap-1.5">
        <span className="numeric text-[10px] tracking-[0.14em] text-low uppercase">BPM</span>
        <input
          type="number"
          min={BPM_MIN}
          max={BPM_MAX}
          value={project.bpm}
          onChange={(e) => {
            const bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, Number(e.target.value) || BPM_MIN));
            onUpdate((draft) => {
              draft.bpm = bpm;
            });
          }}
          className="numeric w-16 rounded-[4px] border border-hairline bg-chrome-2 px-2 py-1.5 text-sm text-hi outline-none focus:border-accent-state"
        />
      </label>
      <label className="flex items-center gap-1.5">
        <span className="numeric text-[10px] tracking-[0.14em] text-low uppercase">Time</span>
        <select
          value={`${project.timeSignature.beatsPerBar}/${project.timeSignature.beatUnit}`}
          onChange={(e) => {
            const [beats, unit] = e.target.value.split('/').map(Number);
            onUpdate((draft) => {
              draft.timeSignature = { beatsPerBar: beats ?? 4, beatUnit: unit ?? 4 };
            });
          }}
          className="numeric rounded-[4px] border border-hairline bg-chrome-2 px-2 py-1.5 text-sm text-hi outline-none focus:border-accent-state"
        >
          {['4/4', '2/4', '3/4', '6/8', '12/8'].map((sig) => (
            <option key={sig} value={sig}>
              {sig}
            </option>
          ))}
        </select>
      </label>

      {/* metronome + count-in + loop */}
      <div className="flex items-center gap-1.5">
        <ToggleChip
          label="Click"
          active={project.metronome.enabled}
          onClick={() =>
            onUpdate((draft) => {
              draft.metronome.enabled = !draft.metronome.enabled;
            })
          }
        />
        <select
          aria-label="Count-in bars"
          value={project.metronome.countInBars}
          onChange={(e) =>
            onUpdate((draft) => {
              draft.metronome.countInBars = Number(e.target.value) as 0 | 1 | 2;
            })
          }
          className="numeric rounded-[4px] border border-hairline bg-chrome-2 px-1.5 py-1.5 text-xs text-hi outline-none focus:border-accent-state"
        >
          <option value={0}>no count-in</option>
          <option value={1}>1 bar in</option>
          <option value={2}>2 bars in</option>
        </select>
        <ToggleChip
          label="Loop"
          active={project.loop.enabled}
          onClick={() =>
            onUpdate((draft) => {
              draft.loop.enabled = !draft.loop.enabled;
            })
          }
        />
      </div>

      {/* qaraami scale lock */}
      <div className="flex items-center gap-1.5">
        <ToggleChip
          label="Scale lock"
          active={project.scaleLock.enabled}
          onClick={() =>
            onUpdate((draft) => {
              draft.scaleLock.enabled = !draft.scaleLock.enabled;
            })
          }
        />
        <select
          aria-label="Scale root"
          value={project.scaleLock.root}
          onChange={(e) =>
            onUpdate((draft) => {
              draft.scaleLock.root = Number(e.target.value);
            })
          }
          className="numeric rounded-[4px] border border-hairline bg-chrome-2 px-1.5 py-1.5 text-xs text-hi outline-none focus:border-accent-state"
        >
          {ROOT_NAMES.map((name, pc) => (
            <option key={name} value={pc}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="Scale mode"
          value={project.scaleLock.mode}
          onChange={(e) =>
            onUpdate((draft) => {
              draft.scaleLock.mode = e.target.value as DawProject['scaleLock']['mode'];
            })
          }
          className="numeric max-w-36 rounded-[4px] border border-hairline bg-chrome-2 px-1.5 py-1.5 text-xs text-hi outline-none focus:border-accent-state"
        >
          {PENTATONIC_MODES.map((mode) => (
            <option key={mode.id} value={mode.id}>
              {mode.label}
            </option>
          ))}
        </select>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={onOpen}
          className="rounded-[4px] border border-hairline px-3 py-1.5 text-sm text-mid transition-colors hover:border-accent-state hover:text-hi"
        >
          Projects
        </button>
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          className="rounded-[4px] border border-accent-state/50 px-3 py-1.5 text-sm font-semibold text-accent-state transition-colors hover:bg-accent-state hover:text-page disabled:opacity-50"
        >
          {exporting ? 'Rendering…' : 'Export WAV'}
        </button>
      </div>
    </header>
  );
}

function ToggleChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`numeric rounded-[4px] border px-2.5 py-1.5 text-[11px] tracking-[0.12em] uppercase transition-colors ${
        active
          ? 'border-accent-state bg-accent-state/15 text-accent-state'
          : 'border-hairline text-low hover:text-hi'
      }`}
    >
      {label}
    </button>
  );
}
