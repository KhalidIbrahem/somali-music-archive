'use client';

/**
 * Transport (Studio v2) — a dense, Logic-style control bar: project name and
 * save state; go-to-start / play-stop / record; cycle, metronome and
 * count-in; an LCD with bars·beats·sixteenths and clock time; BPM, time
 * signature and the qaraami scale lock; undo/redo, musical typing, MIDI
 * input, the shortcut list, projects and WAV export. Wraps to two rows on
 * narrow screens; controls stay ≥ 32 px touch targets.
 */

import { useState } from 'react';
import Link from 'next/link';
import type { DawEngine, EngineSnapshot } from '@/lib/daw/engine';
import { BPM_MAX, BPM_MIN, type DawProject } from '@/lib/daw/types';
import { PENTATONIC_MODES, ROOT_NAMES } from '@/lib/daw/scales';
import type { UpdateFn } from './DawApp';

/** Where the open project's latest edit lives. */
export type SaveState = 'saving' | 'device' | 'synced';

const SAVE_LABELS: Record<SaveState, string> = {
  saving: 'saving…',
  device: 'saved on this device',
  synced: 'saved to account',
};

const SAVE_TITLES: Record<SaveState, string> = {
  saving: 'Saving the latest edit',
  device:
    'Stored in this browser (IndexedDB), not on a server: clearing site data removes it. Export to keep a copy.',
  synced: 'Stored in this browser and synced to your account',
};

export function Transport({
  project,
  engine,
  transport,
  saveState,
  exporting,
  recording,
  canUndo,
  canRedo,
  typingOn,
  midiStatus,
  onUpdate,
  onExport,
  onOpen,
  onTogglePlay,
  onRecord,
  onUndo,
  onRedo,
  onToggleTyping,
  onEnableMidi,
  onShowShortcuts,
}: {
  project: DawProject;
  engine: DawEngine;
  transport: EngineSnapshot;
  saveState: SaveState;
  exporting: boolean;
  recording: boolean;
  canUndo: boolean;
  canRedo: boolean;
  typingOn: boolean;
  midiStatus: 'off' | 'unavailable' | 'denied' | number;
  onUpdate: UpdateFn;
  onExport: () => void;
  onOpen: () => void;
  onTogglePlay: () => void;
  onRecord: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleTyping: () => void;
  onEnableMidi: () => void;
  onShowShortcuts: () => void;
}): React.JSX.Element {
  const [editingName, setEditingName] = useState(false);
  const playing = transport.state !== 'stopped';
  const beatsPerBar = project.timeSignature.beatsPerBar;
  const beat = Math.max(0, transport.beat);
  const bar = Math.floor(beat / beatsPerBar + 1e-6) + 1;
  const beatInBar = Math.floor((beat % beatsPerBar) + 1e-6) + 1;
  const sixteenth = Math.floor(((beat % 1) + 1e-6) * 4) + 1;
  const seconds = (beat * 60) / project.bpm;
  const clock = `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;

  return (
    <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-hairline bg-chrome-1 px-2 py-1.5">
      <Link
        href="/"
        aria-label="Back to the site"
        className="numeric hidden px-1 text-[11px] text-low transition-colors hover:text-accent-state sm:block"
      >
        ←
      </Link>
      <Link
        href="/studio/score"
        title="Transcription score view"
        className="numeric rounded-[4px] border border-hairline px-2 py-1 text-[10px] tracking-[0.14em] text-low uppercase transition-colors hover:border-accent-state hover:text-hi"
      >
        Score
      </Link>

      {/* name + save state */}
      <div className="flex min-w-0 flex-col leading-tight">
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
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setEditingName(false);
            }}
            className="w-36 rounded-[3px] border border-hairline bg-chrome-2 px-1.5 py-0.5 text-sm text-hi outline-none focus:border-accent-state"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingName(true)}
            className="max-w-36 truncate text-left font-display text-sm text-hi hover:text-accent-state"
            title="Rename project"
          >
            {project.name}
          </button>
        )}
        <span
          className="numeric text-[9px] tracking-[0.14em] text-low uppercase"
          title={SAVE_TITLES[saveState]}
          role="status"
        >
          {SAVE_LABELS[saveState]}
        </span>
      </div>

      <Divider />

      {/* undo / redo */}
      <div className="flex items-center gap-0.5">
        <IconButton label="Undo (⌘Z)" onClick={onUndo} disabled={!canUndo}>
          <path d="M5 4 2 7l3 3M2.5 7H9a3.5 3.5 0 0 1 0 7H6" />
        </IconButton>
        <IconButton label="Redo (⇧⌘Z)" onClick={onRedo} disabled={!canRedo}>
          <path d="M11 4l3 3-3 3M13.5 7H7a3.5 3.5 0 0 0 0 7h3" />
        </IconButton>
      </div>

      <Divider />

      {/* transport */}
      <div className="flex items-center gap-1">
        <IconButton label="Go to start (Return)" onClick={() => engine.returnToStart()}>
          <path d="M3 3v10M13 3 6 8l7 5V3Z" fill="currentColor" />
        </IconButton>
        <button
          type="button"
          aria-label={playing ? 'Stop (Space)' : 'Play (Space)'}
          title={playing ? 'Stop (Space)' : 'Play (Space)'}
          onClick={onTogglePlay}
          className={`flex h-8 w-11 items-center justify-center rounded-[4px] text-page transition-colors ${
            playing ? 'bg-accent-live' : 'bg-accent-state hover:brightness-110'
          }`}
        >
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
              <rect x="1.5" y="1.5" width="9" height="9" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
              <path d="M2.5 1.2v9.6L11 6 2.5 1.2Z" />
            </svg>
          )}
        </button>
        <button
          type="button"
          aria-label={recording ? 'Stop recording (R)' : 'Record (R)'}
          title={recording ? 'Stop recording (R)' : 'Record into the armed track (R)'}
          aria-pressed={recording}
          onClick={onRecord}
          className={`flex h-8 w-9 items-center justify-center rounded-[4px] border transition-colors ${
            recording
              ? 'animate-pulse border-danger bg-danger text-page'
              : 'border-hairline text-danger hover:border-danger'
          }`}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
            <circle cx="6" cy="6" r="5" />
          </svg>
        </button>
        <ToggleChip
          label="Cycle"
          title="Cycle (C)"
          active={project.loop.enabled}
          onClick={() =>
            onUpdate((draft) => {
              draft.loop.enabled = !draft.loop.enabled;
            })
          }
        />
        <ToggleChip
          label="Click"
          title="Metronome (K)"
          active={project.metronome.enabled}
          onClick={() =>
            onUpdate((draft) => {
              draft.metronome.enabled = !draft.metronome.enabled;
            })
          }
        />
        <select
          aria-label="Count-in bars"
          title="Count-in before playing and recording"
          value={project.metronome.countInBars}
          onChange={(e) => {
            const bars = Number(e.target.value) === 2 ? 2 : Number(e.target.value) === 1 ? 1 : 0;
            onUpdate((draft) => {
              draft.metronome.countInBars = bars;
            });
          }}
          className="numeric h-8 rounded-[4px] border border-hairline bg-chrome-2 px-1 text-[11px] text-hi outline-none focus:border-accent-state"
        >
          <option value={0}>no count</option>
          <option value={1}>1 bar in</option>
          <option value={2}>2 bars in</option>
        </select>
      </div>

      {/* LCD */}
      <div className="numeric flex h-9 items-stretch overflow-hidden rounded-[4px] border border-hairline bg-page text-hi">
        <div className="flex flex-col justify-center px-2" aria-label="Position">
          <span className="text-[15px] leading-none tracking-wide">
            {bar}.{beatInBar}.{sixteenth}
          </span>
          <span className="text-[8px] tracking-[0.18em] text-low uppercase">
            {transport.state === 'counting' ? 'count-in' : recording ? 'recording' : 'bar·beat'}
          </span>
        </div>
        <div className="hidden flex-col justify-center border-l border-hairline px-2 xl:flex">
          <span className="text-[13px] leading-none">{clock}</span>
          <span className="text-[8px] tracking-[0.18em] text-low uppercase">time</span>
        </div>
        <label className="flex flex-col justify-center border-l border-hairline px-2">
          <input
            type="number"
            min={BPM_MIN}
            max={BPM_MAX}
            value={project.bpm}
            aria-label="Tempo (BPM)"
            onChange={(e) => {
              const bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, Number(e.target.value) || BPM_MIN));
              onUpdate((draft) => {
                draft.bpm = bpm;
              }, 'bpm');
            }}
            className="w-11 bg-transparent text-[13px] leading-none text-hi outline-none"
          />
          <span className="text-[8px] tracking-[0.18em] text-low uppercase">bpm</span>
        </label>
        <label className="flex flex-col justify-center border-l border-hairline px-1.5">
          <select
            value={`${project.timeSignature.beatsPerBar}/${project.timeSignature.beatUnit}`}
            aria-label="Time signature"
            onChange={(e) => {
              const [beats, unit] = e.target.value.split('/').map(Number);
              onUpdate((draft) => {
                draft.timeSignature = { beatsPerBar: beats ?? 4, beatUnit: unit ?? 4 };
              });
            }}
            className="bg-transparent text-[13px] leading-none text-hi outline-none"
          >
            {['4/4', '2/4', '3/4', '6/8', '12/8'].map((sig) => (
              <option key={sig} value={sig} className="bg-chrome-2">
                {sig}
              </option>
            ))}
          </select>
          <span className="text-[8px] tracking-[0.18em] text-low uppercase">time</span>
        </label>
      </div>

      {/* qaraami scale lock */}
      <div className="flex items-center gap-1">
        <ToggleChip
          label="Scale lock"
          title="Qaraami scale lock — notes snap to the scale"
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
          onChange={(e) => {
            const root = Number(e.target.value);
            onUpdate((draft) => {
              draft.scaleLock.root = root;
            });
          }}
          className="numeric h-8 rounded-[4px] border border-hairline bg-chrome-2 px-1 text-[11px] text-hi outline-none focus:border-accent-state"
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
          onChange={(e) => {
            const mode = PENTATONIC_MODES.find((m) => m.id === e.target.value)?.id;
            if (!mode) return;
            onUpdate((draft) => {
              draft.scaleLock.mode = mode;
            });
          }}
          className="numeric h-8 max-w-28 rounded-[4px] border border-hairline bg-chrome-2 px-1 text-[11px] text-hi outline-none focus:border-accent-state"
        >
          {PENTATONIC_MODES.map((mode) => (
            <option key={mode.id} value={mode.id}>
              {mode.label}
            </option>
          ))}
        </select>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <ToggleChip
          label="Typing"
          title="Musical typing — play notes on the computer keyboard (⌘K)"
          active={typingOn}
          onClick={onToggleTyping}
        />
        <ToggleChip
          label={typeof midiStatus === 'number' ? `MIDI ${midiStatus}` : 'MIDI'}
          title={
            midiStatus === 'off'
              ? 'Connect a MIDI keyboard (Web MIDI)'
              : midiStatus === 'unavailable'
                ? 'This browser has no Web MIDI'
                : midiStatus === 'denied'
                  ? 'MIDI access was not granted — click to retry'
                  : `${midiStatus} MIDI input(s) connected`
          }
          active={typeof midiStatus === 'number' && midiStatus > 0}
          onClick={onEnableMidi}
        />
        <button
          type="button"
          onClick={onShowShortcuts}
          aria-label="Keyboard shortcuts (?)"
          title="Keyboard shortcuts (?)"
          className="numeric flex h-8 w-8 items-center justify-center rounded-[4px] border border-hairline text-xs text-mid transition-colors hover:border-accent-state hover:text-hi"
        >
          ?
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="h-8 rounded-[4px] border border-hairline px-2 text-xs text-mid transition-colors hover:border-accent-state hover:text-hi"
        >
          Projects
        </button>
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          title="Export a WAV mixdown"
          className="h-8 rounded-[4px] border border-accent-state/50 px-2 text-xs font-semibold text-accent-state transition-colors hover:bg-accent-state hover:text-page disabled:opacity-50"
        >
          {exporting ? 'Rendering…' : 'Export'}
        </button>
      </div>
    </header>
  );
}

function Divider(): React.JSX.Element {
  return <span aria-hidden className="hidden h-6 w-px bg-hairline 2xl:block" />;
}

function IconButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-[4px] text-mid transition-colors hover:bg-chrome-2 hover:text-hi disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {children}
      </svg>
    </button>
  );
}

function ToggleChip({
  label,
  title,
  active,
  onClick,
}: {
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`numeric h-8 rounded-[4px] border px-1.5 text-[10px] tracking-[0.08em] uppercase transition-colors ${
        active
          ? 'border-accent-state bg-accent-state/15 text-accent-state'
          : 'border-hairline text-low hover:text-hi'
      }`}
    >
      {label}
    </button>
  );
}
