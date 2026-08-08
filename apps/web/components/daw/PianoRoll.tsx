'use client';

/**
 * PianoRoll (Stage 5 Tier 1) — draw (tap empty cell), move (drag body),
 * resize (drag right edge), select + velocity slider + delete. Snap grid
 * selectable (1 · 1/2 · 1/4 beat). QARAAMI SCALE LOCK: when the project lock
 * is on, ONLY in-scale rows are rendered — out-of-scale pitches cannot even
 * be expressed. Existing out-of-scale notes (imports) stay audible and
 * become visible again when the lock is off; rows carrying them are kept.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { DawEngine } from '@/lib/daw/engine';
import { isInScale, midiName } from '@/lib/daw/scales';
import { newId, type DawProject, type DawRegion, type DawTrack } from '@/lib/daw/types';

const ROW_H = 16;
const KEYS_W = 56;
const MIDI_LO = 36;
const MIDI_HI = 96;

type Drag =
  | { kind: 'move'; noteId: string; grabOffset: number; row0Midi: number }
  | { kind: 'resize'; noteId: string };

export function PianoRoll({
  project,
  track,
  region,
  engine,
  onUpdate,
}: {
  project: DawProject;
  track: DawTrack;
  region: DawRegion;
  engine: DawEngine;
  onUpdate: (mutate: (draft: DawProject) => void) => void;
}): React.JSX.Element {
  const [snapBeats, setSnapBeats] = useState(0.5);
  const [pxPerBeat, setPxPerBeat] = useState(48);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const { scaleLock } = project;

  /** Visible pitch rows, top (high) → bottom (low). */
  const rows = useMemo((): number[] => {
    const used = new Set(region.notes.map((n) => n.midi));
    const out: number[] = [];
    for (let midi = MIDI_HI; midi >= MIDI_LO; midi--) {
      const inScale = !scaleLock.enabled || isInScale(midi, scaleLock.root, scaleLock.mode);
      if (inScale || used.has(midi)) out.push(midi);
    }
    return out;
  }, [region.notes, scaleLock]);

  const rowOf = useMemo(() => {
    const map = new Map<number, number>();
    rows.forEach((midi, index) => map.set(midi, index));
    return map;
  }, [rows]);

  const snap = useCallback(
    (beat: number): number => Math.round(beat / snapBeats) * snapBeats,
    [snapBeats],
  );

  const pointToCell = useCallback(
    (e: { clientX: number; clientY: number }): { beat: number; midi: number } | null => {
      const grid = gridRef.current;
      if (!grid) return null;
      const rect = grid.getBoundingClientRect();
      const x = e.clientX - rect.left + grid.scrollLeft - KEYS_W;
      const y = e.clientY - rect.top + grid.scrollTop;
      const rowIndex = Math.floor(y / ROW_H);
      const midi = rows[rowIndex];
      if (midi === undefined || x < 0) return null;
      return { beat: Math.max(0, x / pxPerBeat), midi };
    },
    [rows, pxPerBeat],
  );

  const editNote = useCallback(
    (
      noteId: string,
      fn: (note: {
        startBeat: number;
        lengthBeats: number;
        midi: number;
        velocity: number;
      }) => void,
    ): void => {
      onUpdate((draft) => {
        const note = draft.tracks
          .find((t) => t.id === track.id)
          ?.regions.find((r) => r.id === region.id)
          ?.notes.find((n) => n.id === noteId);
        if (note) fn(note);
      });
    },
    [onUpdate, track.id, region.id],
  );

  const onGridPointerDown = (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).dataset['note'] !== undefined) return; // notes handle themselves
    const cell = pointToCell(e);
    if (!cell || cell.beat >= region.lengthBeats) return;
    const startBeat = Math.min(region.lengthBeats - snapBeats, snap(cell.beat));
    const note = {
      id: newId('nt'),
      startBeat,
      lengthBeats: snapBeats,
      midi: cell.midi,
      velocity: 0.85,
    };
    onUpdate((draft) => {
      draft.tracks
        .find((t) => t.id === track.id)
        ?.regions.find((r) => r.id === region.id)
        ?.notes.push(note);
    });
    setSelectedNoteId(note.id);
    engine.audition(track.instrument, cell.midi);
  };

  const onNotePointerDown = (e: React.PointerEvent, noteId: string, resize: boolean): void => {
    e.stopPropagation();
    setSelectedNoteId(noteId);
    const note = region.notes.find((n) => n.id === noteId);
    const cell = pointToCell(e);
    if (!note || !cell) return;
    dragRef.current = resize
      ? { kind: 'resize', noteId }
      : { kind: 'move', noteId, grabOffset: cell.beat - note.startBeat, row0Midi: note.midi };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const drag = dragRef.current;
    if (!drag) return;
    const cell = pointToCell(e);
    if (!cell) return;
    if (drag.kind === 'move') {
      editNote(drag.noteId, (note) => {
        note.startBeat = Math.max(
          0,
          Math.min(region.lengthBeats - note.lengthBeats, snap(cell.beat - drag.grabOffset)),
        );
        note.midi = cell.midi;
      });
    } else {
      editNote(drag.noteId, (note) => {
        note.lengthBeats = Math.max(
          snapBeats,
          Math.min(region.lengthBeats - note.startBeat, snap(cell.beat - note.startBeat)),
        );
      });
    }
  };

  const onPointerUp = (): void => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.kind === 'move') {
      const note = region.notes.find((n) => n.id === drag.noteId);
      if (note && note.midi !== drag.row0Midi) engine.audition(track.instrument, note.midi);
    }
  };

  const selectedNote = region.notes.find((n) => n.id === selectedNoteId) ?? null;
  const gridWidth = region.lengthBeats * pxPerBeat;
  const beatsPerBar = project.timeSignature.beatsPerBar;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-1">
        <label className="numeric flex items-center gap-1 text-[10px] tracking-[0.14em] text-low uppercase">
          Snap
          <select
            value={snapBeats}
            onChange={(e) => setSnapBeats(Number(e.target.value))}
            className="numeric rounded-[4px] border border-hairline bg-chrome-2 px-1.5 py-1 text-xs text-hi outline-none"
          >
            <option value={1}>1 beat</option>
            <option value={0.5}>1/2</option>
            <option value={0.25}>1/4</option>
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => setPxPerBeat((z) => Math.max(24, z - 8))}
            className="numeric rounded-[4px] border border-hairline px-2 py-1 text-[11px] text-mid hover:text-hi"
          >
            −
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => setPxPerBeat((z) => Math.min(96, z + 8))}
            className="numeric rounded-[4px] border border-hairline px-2 py-1 text-[11px] text-mid hover:text-hi"
          >
            +
          </button>
        </div>
        {scaleLock.enabled ? (
          <span className="numeric text-[10px] tracking-[0.14em] text-accent-state uppercase">
            scale lock on — only in-scale rows shown
          </span>
        ) : null}
        {selectedNote !== null ? (
          <div className="ml-auto flex items-center gap-2">
            <span className="numeric text-[11px] text-hi">{midiName(selectedNote.midi)}</span>
            <label className="numeric flex items-center gap-1.5 text-[10px] tracking-[0.14em] text-low uppercase">
              Vel
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={selectedNote.velocity}
                onChange={(e) =>
                  editNote(selectedNote.id, (note) => {
                    note.velocity = Number(e.target.value);
                  })
                }
                className="w-24 accent-(--accent-state)"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                onUpdate((draft) => {
                  const r = draft.tracks
                    .find((t) => t.id === track.id)
                    ?.regions.find((x) => x.id === region.id);
                  if (r) r.notes = r.notes.filter((n) => n.id !== selectedNote.id);
                });
                setSelectedNoteId(null);
              }}
              className="numeric rounded-[4px] border border-hairline px-2 py-1 text-[11px] text-low uppercase hover:border-danger hover:text-danger"
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>

      <div
        ref={gridRef}
        className="min-h-0 flex-1 touch-none overflow-auto overscroll-contain"
        onPointerDown={onGridPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div
          className="relative"
          style={{ width: gridWidth + KEYS_W, height: rows.length * ROW_H }}
        >
          {/* key names */}
          <div className="absolute top-0 left-0 z-10 h-full bg-chrome-1" style={{ width: KEYS_W }}>
            {rows.map((midi, index) => (
              <button
                key={midi}
                type="button"
                onClick={() => engine.audition(track.instrument, midi)}
                className={`numeric block w-full border-b border-r border-hairline text-right text-[9px] leading-none ${
                  midi % 12 === scaleLock.root ? 'text-accent-state' : 'text-low'
                } pr-1.5 hover:text-hi`}
                style={{ height: ROW_H, top: index * ROW_H }}
              >
                {midiName(midi)}
              </button>
            ))}
          </div>

          {/* rows + bar lines */}
          <div className="absolute inset-y-0" style={{ left: KEYS_W, width: gridWidth }}>
            {rows.map((midi, index) => (
              <div
                key={midi}
                aria-hidden
                className={`absolute w-full border-b border-hairline/60 ${
                  midi % 12 === scaleLock.root ? 'bg-accent-state/6' : ''
                }`}
                style={{ top: index * ROW_H, height: ROW_H }}
              />
            ))}
            {Array.from({ length: Math.ceil(region.lengthBeats) + 1 }, (_, beat) => (
              <div
                key={beat}
                aria-hidden
                className={`absolute h-full w-px ${beat % beatsPerBar === 0 ? 'bg-hairline' : 'bg-hairline/40'}`}
                style={{ left: beat * pxPerBeat }}
              />
            ))}

            {/* notes */}
            {region.notes.map((note) => {
              const rowIndex = rowOf.get(note.midi);
              if (rowIndex === undefined) return null;
              const selected = note.id === selectedNoteId;
              return (
                <div
                  key={note.id}
                  data-note
                  role="button"
                  tabIndex={0}
                  aria-label={`${midiName(note.midi)} at beat ${note.startBeat + 1}`}
                  onPointerDown={(e) => onNotePointerDown(e, note.id, false)}
                  className={`absolute cursor-grab rounded-[2px] border ${
                    selected
                      ? 'z-10 border-hi bg-accent-state'
                      : 'border-accent-state/70 bg-accent-state/80'
                  }`}
                  style={{
                    left: note.startBeat * pxPerBeat,
                    top: rowIndex * ROW_H + 2,
                    width: Math.max(6, note.lengthBeats * pxPerBeat - 1),
                    height: ROW_H - 4,
                    opacity: 0.35 + 0.65 * note.velocity,
                  }}
                >
                  <div
                    data-note
                    role="presentation"
                    onPointerDown={(e) => onNotePointerDown(e, note.id, true)}
                    className="absolute top-0 right-0 h-full w-2 cursor-ew-resize"
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
