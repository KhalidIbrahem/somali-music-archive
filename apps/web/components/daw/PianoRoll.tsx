'use client';

/**
 * PianoRoll (Studio v2) — the MIDI editor.
 *
 *  • Tools: Pointer (drag empty = marquee), Draw (click empty = note, drag to
 *    set its length), Erase (click / drag over notes).
 *  • Notes: click / shift-click / marquee to select; drag the body to move
 *    (snapped; ⌘ ignores the grid), drag the right edge to change length —
 *    both act on the whole selection and are one undo step per gesture.
 *  • Velocity lane under the grid: drag a stem up/down (acts on the
 *    selection when the stem's note is selected).
 *  • Quantize (Q) at the chosen strength; snap grid shared with the tracks.
 *  • QARAAMI SCALE LOCK: in-scale rows are highlighted; with the lock on,
 *    drawn/moved notes snap into the scale, and "Fold" (on by default)
 *    shows only in-scale rows — out-of-scale pitches can't even be
 *    expressed. Existing out-of-scale notes stay audible and visible.
 *
 * Selection, clipboard, delete and transpose keys live in DawApp (shortcuts).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DawEngine, EngineSnapshot } from '@/lib/daw/engine';
import { isInScale, midiName } from '@/lib/daw/scales';
import type { DawNote, DawProject, DawRegion, DawTrack } from '@/lib/daw/types';
import {
  addNote,
  deleteNotes,
  moveNotes,
  notesInBox,
  resizeNotes,
  setNotesVelocity,
  snapBeat,
  snapBeats,
  SNAP_OPTIONS,
  MIN_NOTE_BEATS,
  type RegionRef,
  type SnapValue,
} from '@/lib/daw/editOps';
import { lockToScale } from '@/lib/daw/musicalTyping';
import type { CommitFn } from './DawApp';

const ROW_H = 14;
const KEYS_W = 52;
const RULER_H = 16;
const VEL_H = 52;
const MIDI_LO = 36;
const MIDI_HI = 96;
const BLACK = new Set([1, 3, 6, 8, 10]);

type Tool = 'pointer' | 'draw' | 'erase';

let gestureCounter = 0;
function gestureKey(prefix: string): string {
  gestureCounter += 1;
  return `roll-${prefix}:${gestureCounter}`;
}

function startDrag(
  e: React.PointerEvent,
  onMove: (ev: PointerEvent) => void,
  onUp?: (ev: PointerEvent, moved: boolean) => void,
): void {
  const x0 = e.clientX;
  const y0 = e.clientY;
  let moved = false;
  const move = (ev: PointerEvent): void => {
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
    moved = true;
    onMove(ev);
  };
  const up = (ev: PointerEvent): void => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    onUp?.(ev, moved);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

export function PianoRoll({
  project,
  track,
  region,
  regionRef,
  engine,
  transport,
  snap,
  selectedNoteIds,
  quantizeStrength,
  onSelectNotes,
  onCommit,
  onQuantize,
  onQuantizeStrength,
  onSnapChange,
}: {
  project: DawProject;
  track: DawTrack;
  region: DawRegion;
  regionRef: RegionRef;
  engine: DawEngine;
  transport: EngineSnapshot;
  snap: SnapValue;
  selectedNoteIds: string[];
  quantizeStrength: number;
  onSelectNotes: (ids: string[]) => void;
  onCommit: CommitFn;
  onQuantize: () => void;
  onQuantizeStrength: (strength: number) => void;
  onSnapChange: (snap: SnapValue) => void;
}): React.JSX.Element {
  const [tool, setTool] = useState<Tool>('draw');
  const [pxPerBeat, setPxPerBeat] = useState(56);
  const [fold, setFold] = useState(true);
  const [drawLength, setDrawLength] = useState<number | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; x1: number; y0: number; y1: number } | null>(
    null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const velRef = useRef<HTMLDivElement>(null);

  const { scaleLock } = project;
  const grid = snapBeats(snap, project.timeSignature);
  const beatsPerBar = project.timeSignature.beatsPerBar;
  const selected = useMemo(() => new Set(selectedNoteIds), [selectedNoteIds]);
  const folded = scaleLock.enabled && fold;

  /** Visible pitch rows, top (high) → bottom (low). */
  const rows = useMemo((): number[] => {
    const used = new Set(region.notes.map((n) => n.midi));
    let lo = MIDI_LO;
    let hi = MIDI_HI;
    for (const midi of used) {
      lo = Math.min(lo, midi);
      hi = Math.max(hi, midi);
    }
    const out: number[] = [];
    for (let midi = hi; midi >= lo; midi--) {
      const inScale = isInScale(midi, scaleLock.root, scaleLock.mode);
      if (!folded || inScale || used.has(midi)) out.push(midi);
    }
    return out;
  }, [region.notes, scaleLock.root, scaleLock.mode, folded]);

  const rowOf = useMemo(() => {
    const map = new Map<number, number>();
    rows.forEach((midi, index) => map.set(midi, index));
    return map;
  }, [rows]);

  // Bring the region's notes into view when a new region opens.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const top = Math.max(...region.notes.map((n) => n.midi), 72);
    const index = rowOf.get(top) ?? Math.floor(rows.length / 3);
    scroller.scrollTop = Math.max(0, index * ROW_H - ROW_H * 2);
    scroller.scrollLeft = 0;
    // Only on region change — not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region.id]);

  // ⌃/⌘-wheel zoom inside the editor.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setPxPerBeat((z) => Math.min(240, Math.max(16, z * Math.exp(-e.deltaY * 0.01))));
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, []);

  const gridWidth = region.lengthBeats * pxPerBeat;
  const rowsH = rows.length * ROW_H;

  const cellAt = (ev: { clientX: number; clientY: number }): { beat: number; row: number } => {
    const el = gridRef.current;
    if (!el) return { beat: 0, row: 0 };
    const rect = el.getBoundingClientRect();
    return {
      beat: Math.max(0, (ev.clientX - rect.left) / pxPerBeat),
      row: Math.max(0, Math.min(rows.length - 1, Math.floor((ev.clientY - rect.top) / ROW_H))),
    };
  };
  const snapFor = (beat: number, ev: { metaKey: boolean; ctrlKey: boolean }): number =>
    ev.metaKey || ev.ctrlKey ? beat : snapBeat(beat, grid);
  const floorToGrid = (beat: number): number =>
    grid === null ? beat : Math.floor(beat / grid + 1e-6) * grid;
  const pitchFor = (midi: number): number =>
    scaleLock.enabled ? lockToScale(midi, scaleLock) : midi;
  const noteAt = (beat: number, midi: number): DawNote | undefined =>
    region.notes.find(
      (n) => n.midi === midi && beat >= n.startBeat && beat < n.startBeat + n.lengthBeats,
    );

  // ── notes ─────────────────────────────────────────────────────────────────
  const onNotePointerDown = (e: React.PointerEvent, note: DawNote, edge: boolean): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (tool === 'erase') {
      onCommit(deleteNotes(project, regionRef, [note.id]));
      onSelectNotes(selectedNoteIds.filter((id) => id !== note.id));
      return;
    }
    if (e.shiftKey) {
      onSelectNotes(
        selected.has(note.id)
          ? selectedNoteIds.filter((id) => id !== note.id)
          : [...selectedNoteIds, note.id],
      );
      return;
    }
    const ids = selected.has(note.id) ? selectedNoteIds : [note.id];
    if (!selected.has(note.id)) onSelectNotes([note.id]);
    engine.audition(track.instrument, note.midi, note.velocity);
    const origin = project;
    const key = gestureKey(edge ? 'len' : 'move');
    const grab = cellAt(e);
    const grabRow = rowOf.get(note.midi) ?? grab.row;
    let lastMidi = note.midi;
    startDrag(
      e,
      (ev) => {
        const cell = cellAt(ev);
        if (edge) {
          const end = snapFor(cell.beat, ev);
          const delta = end - (note.startBeat + note.lengthBeats);
          onCommit(resizeNotes(origin, regionRef, ids, delta, grid ?? MIN_NOTE_BEATS), key);
          setDrawLength(Math.max(grid ?? MIN_NOTE_BEATS, note.lengthBeats + delta));
          return;
        }
        const newStart = snapFor(note.startBeat + cell.beat - grab.beat, ev);
        const targetRow = Math.max(0, Math.min(rows.length - 1, grabRow + cell.row - grab.row));
        const targetMidi = rows[targetRow] ?? note.midi;
        onCommit(
          moveNotes(
            origin,
            regionRef,
            ids,
            newStart - note.startBeat,
            targetMidi - note.midi,
            pitchFor,
          ),
          key,
        );
        if (targetMidi !== lastMidi) {
          lastMidi = targetMidi;
          engine.audition(track.instrument, pitchFor(targetMidi), note.velocity);
        }
      },
      (_ev, moved) => {
        if (!moved && selectedNoteIds.length > 1 && selected.has(note.id)) onSelectNotes([note.id]);
      },
    );
  };

  // ── empty grid ────────────────────────────────────────────────────────────
  const onGridPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const start = cellAt(e);
    if (tool === 'erase') {
      let working = project;
      const key = gestureKey('erase');
      const eraseAt = (ev: { clientX: number; clientY: number }): void => {
        const cell = cellAt(ev);
        const midi = rows[cell.row];
        if (midi === undefined) return;
        const hit = noteAt(cell.beat, midi);
        if (!hit) return;
        working = deleteNotes(working, regionRef, [hit.id]);
        onCommit(working, key);
      };
      eraseAt(e);
      startDrag(e, eraseAt);
      return;
    }
    if (tool === 'draw' && !e.shiftKey) {
      const rowMidi = rows[start.row];
      if (rowMidi === undefined) return;
      const startBeat = e.metaKey || e.ctrlKey ? start.beat : floorToGrid(start.beat);
      if (startBeat >= region.lengthBeats) return;
      const midi = pitchFor(rowMidi);
      const length = Math.min(
        drawLength ?? grid ?? 0.5,
        Math.max(MIN_NOTE_BEATS, region.lengthBeats - startBeat),
      );
      const velocity = 0.8;
      const added = addNote(project, regionRef, {
        startBeat,
        lengthBeats: length,
        midi,
        velocity,
      });
      const noteId = added.noteId;
      if (noteId === null) return;
      const key = gestureKey('draw');
      onCommit(added.project, key);
      onSelectNotes([noteId]);
      engine.audition(track.instrument, midi, velocity);
      startDrag(
        e,
        (ev) => {
          const end = snapFor(cellAt(ev).beat, ev);
          const nextLength = Math.max(grid ?? MIN_NOTE_BEATS, end - startBeat);
          onCommit(resizeNotes(added.project, regionRef, [noteId], nextLength - length), key);
        },
        (ev, moved) => {
          if (moved) {
            const end = snapFor(cellAt(ev).beat, ev);
            setDrawLength(Math.max(grid ?? MIN_NOTE_BEATS, end - startBeat));
          }
        },
      );
      return;
    }
    // Pointer tool (or shift in draw): marquee.
    const base = e.shiftKey ? selectedNoteIds : [];
    const el = gridRef.current;
    if (!el) return;
    const rect0 = el.getBoundingClientRect();
    const y0 = e.clientY - rect0.top;
    startDrag(
      e,
      (ev) => {
        const rect = el.getBoundingClientRect();
        const cell = cellAt(ev);
        const y1 = ev.clientY - rect.top;
        setMarquee({ x0: start.beat, x1: cell.beat, y0, y1 });
        const r0 = Math.max(0, Math.floor(Math.min(y0, y1) / ROW_H));
        const r1 = Math.min(rows.length - 1, Math.floor(Math.max(y0, y1) / ROW_H));
        const ids = notesInBox(region, {
          startBeat: start.beat,
          endBeat: cell.beat,
          highMidi: rows[r0] ?? MIDI_HI,
          lowMidi: rows[r1] ?? MIDI_LO,
        });
        onSelectNotes([...base, ...ids.filter((id) => !base.includes(id))]);
      },
      (_ev, moved) => {
        setMarquee(null);
        if (!moved && !e.shiftKey) onSelectNotes([]);
      },
    );
  };

  // ── velocity lane ─────────────────────────────────────────────────────────
  const onVelocityPointerDown = (e: React.PointerEvent): void => {
    const el = velRef.current;
    if (!el || e.button !== 0) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let best: DawNote | null = null;
    let bestDistance = 8;
    for (const note of region.notes) {
      const distance = Math.abs(note.startBeat * pxPerBeat + 2 - x);
      const better =
        distance < bestDistance ||
        (distance === bestDistance &&
          best !== null &&
          selected.has(note.id) &&
          !selected.has(best.id));
      if (better) {
        best = note;
        bestDistance = distance;
      }
    }
    if (best === null) return;
    const target = best;
    const ids = selected.has(target.id) ? selectedNoteIds : [target.id];
    if (!selected.has(target.id)) onSelectNotes([target.id]);
    const origin = project;
    const key = gestureKey('vel');
    const apply = (ev: { clientY: number }): void => {
      const r = el.getBoundingClientRect();
      const v = 1 - (ev.clientY - r.top) / r.height;
      onCommit(setNotesVelocity(origin, regionRef, ids, v), key);
    };
    apply(e);
    startDrag(e, apply, () => engine.audition(track.instrument, target.midi));
  };

  // ── derived view ──────────────────────────────────────────────────────────
  const selectedNotes = region.notes.filter((n) => selected.has(n.id));
  const avgVelocity =
    selectedNotes.length > 0
      ? selectedNotes.reduce((sum, n) => sum + n.velocity, 0) / selectedNotes.length
      : null;
  const rel = transport.beat - region.startBeat;
  const span = region.lengthBeats * region.loopCount;
  const playheadX =
    rel >= 0 && rel < span && region.lengthBeats > 0
      ? (rel % region.lengthBeats) * pxPerBeat
      : null;
  const subdivision = grid !== null && grid * pxPerBeat >= 8 ? grid : null;
  const lineBackground = {
    backgroundImage: [
      'linear-gradient(90deg, var(--hairline) 0 1px, transparent 1px)',
      'linear-gradient(90deg, color-mix(in srgb, var(--hairline) 60%, transparent) 0 1px, transparent 1px)',
      subdivision !== null
        ? 'linear-gradient(90deg, color-mix(in srgb, var(--hairline) 28%, transparent) 0 1px, transparent 1px)'
        : 'none',
    ].join(', '),
    backgroundSize: `${beatsPerBar * pxPerBeat}px 100%, ${pxPerBeat}px 100%, ${
      (subdivision ?? 1) * pxPerBeat
    }px 100%`,
  };

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-hairline px-2">
        <div
          className="flex shrink-0 overflow-hidden rounded-[3px] border border-hairline"
          role="group"
          aria-label="Tool"
        >
          {(
            [
              ['pointer', 'Pointer', 'Select and move (drag empty space = marquee)'],
              ['draw', 'Draw', 'Click to add a note, drag to set its length'],
              ['erase', 'Erase', 'Click or drag over notes to delete them'],
            ] as const
          ).map(([id, label, hint]) => (
            <button
              key={id}
              type="button"
              aria-pressed={tool === id}
              title={hint}
              onClick={() => setTool(id)}
              className={`numeric h-6 px-2 text-[10px] tracking-wide uppercase transition-colors ${
                tool === id ? 'bg-accent-state/20 text-accent-state' : 'text-low hover:text-hi'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="numeric flex shrink-0 items-center gap-1 text-[9px] tracking-[0.14em] text-low uppercase">
          Snap
          <select
            value={snap}
            onChange={(e) => {
              const value = SNAP_OPTIONS.find((o) => o.value === e.target.value)?.value;
              if (value) onSnapChange(value);
            }}
            className="numeric h-6 rounded-[3px] border border-hairline bg-chrome-2 px-1 text-[11px] tracking-normal text-hi normal-case outline-none"
          >
            {SNAP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onQuantize}
            title="Quantize selected notes (all when none selected) to the snap grid (Q)"
            className="numeric h-6 rounded-[3px] border border-hairline px-2 text-[10px] tracking-wide text-mid uppercase hover:border-accent-state hover:text-hi"
          >
            Quantize
          </button>
          <select
            aria-label="Quantize strength"
            value={Math.round(quantizeStrength * 100)}
            onChange={(e) => onQuantizeStrength(Number(e.target.value) / 100)}
            className="numeric h-6 rounded-[3px] border border-hairline bg-chrome-2 px-0.5 text-[10px] text-hi outline-none"
          >
            {[100, 90, 75, 50, 25].map((s) => (
              <option key={s} value={s}>
                {s}%
              </option>
            ))}
          </select>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => setPxPerBeat((z) => Math.max(16, z * 0.8))}
            className="numeric h-6 rounded-[3px] border border-hairline px-2 text-[11px] text-mid hover:text-hi"
          >
            −
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => setPxPerBeat((z) => Math.min(240, z * 1.25))}
            className="numeric h-6 rounded-[3px] border border-hairline px-2 text-[11px] text-mid hover:text-hi"
          >
            +
          </button>
        </div>
        {scaleLock.enabled ? (
          <button
            type="button"
            aria-pressed={fold}
            onClick={() => setFold((f) => !f)}
            title="Fold: show only in-scale rows"
            className={`numeric h-6 shrink-0 rounded-[3px] border px-2 text-[10px] tracking-wide uppercase ${
              fold
                ? 'border-accent-state bg-accent-state/15 text-accent-state'
                : 'border-hairline text-low hover:text-hi'
            }`}
          >
            Fold to scale
          </button>
        ) : (
          <span className="numeric shrink-0 text-[9px] tracking-[0.14em] text-low uppercase">
            scale rows tinted
          </span>
        )}
        {selectedNotes.length > 0 ? (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span className="numeric text-[10px] text-hi">
              {selectedNotes.length === 1 && selectedNotes[0]
                ? midiName(selectedNotes[0].midi)
                : `${selectedNotes.length} notes`}
            </span>
            <label className="numeric flex items-center gap-1 text-[9px] tracking-[0.14em] text-low uppercase">
              Vel
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.01}
                value={avgVelocity ?? 0.8}
                onChange={(e) =>
                  onCommit(
                    setNotesVelocity(project, regionRef, selectedNoteIds, Number(e.target.value)),
                    `roll-vel-slider:${region.id}`,
                  )
                }
                className="w-20 accent-(--accent-state)"
              />
              <span className="w-6 text-hi">{Math.round((avgVelocity ?? 0) * 127)}</span>
            </label>
            <button
              type="button"
              onClick={() => {
                onCommit(deleteNotes(project, regionRef, selectedNoteIds));
                onSelectNotes([]);
              }}
              className="numeric h-6 rounded-[3px] border border-hairline px-2 text-[10px] text-low uppercase hover:border-danger hover:text-danger"
            >
              Delete
            </button>
          </div>
        ) : (
          <span className="numeric ml-auto hidden shrink-0 text-[9px] text-low lg:block">
            ↑↓ transpose · ⇧↑↓ octave · ⌘C/⌘V · ⌫ · Q
          </span>
        )}
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto overscroll-contain">
        <div style={{ width: KEYS_W + gridWidth, minHeight: RULER_H + rowsH + VEL_H }}>
          {/* ruler */}
          <div
            className="sticky top-0 z-20 flex border-b border-hairline bg-chrome-1"
            style={{ height: RULER_H }}
          >
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-hairline bg-chrome-1"
              style={{ width: KEYS_W }}
            />
            <div
              className="relative cursor-text touch-none"
              style={{ width: gridWidth }}
              onPointerDown={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const beat = snapFor((e.clientX - rect.left) / pxPerBeat, e);
                engine.seek(region.startBeat + Math.max(0, beat));
              }}
            >
              {Array.from({ length: Math.ceil(region.lengthBeats / beatsPerBar) }, (_, bar) => (
                <span
                  key={bar}
                  className="numeric pointer-events-none absolute top-0.5 text-[9px] text-low select-none"
                  style={{ left: bar * beatsPerBar * pxPerBeat + 3 }}
                >
                  {Math.floor(region.startBeat / beatsPerBar) + bar + 1}
                </span>
              ))}
            </div>
          </div>

          <div className="flex" style={{ height: rowsH }}>
            {/* keys */}
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-hairline bg-chrome-1"
              style={{ width: KEYS_W }}
            >
              {rows.map((midi) => {
                const pc = ((midi % 12) + 12) % 12;
                const isRoot = pc === scaleLock.root;
                return (
                  <button
                    key={midi}
                    type="button"
                    tabIndex={-1}
                    onPointerDown={() => engine.audition(track.instrument, midi)}
                    className={`numeric block w-full border-b border-hairline/50 pr-1 text-right text-[8px] leading-none ${
                      BLACK.has(pc) ? 'bg-page text-low' : 'bg-chrome-2 text-mid'
                    } ${isRoot ? 'text-accent-state' : ''} hover:text-hi`}
                    style={{ height: ROW_H }}
                  >
                    {midiName(midi)}
                  </button>
                );
              })}
            </div>

            {/* grid */}
            <div
              ref={gridRef}
              className={`relative touch-none ${
                tool === 'draw'
                  ? 'cursor-crosshair'
                  : tool === 'erase'
                    ? 'cursor-not-allowed'
                    : 'cursor-default'
              }`}
              style={{ width: gridWidth, height: rowsH }}
              onPointerDown={onGridPointerDown}
            >
              {rows.map((midi, index) => {
                const pc = ((midi % 12) + 12) % 12;
                const inScale = isInScale(midi, scaleLock.root, scaleLock.mode);
                const tint =
                  pc === scaleLock.root
                    ? 'bg-accent-state/12'
                    : inScale
                      ? 'bg-accent-state/5'
                      : scaleLock.enabled
                        ? 'bg-page/70'
                        : BLACK.has(pc)
                          ? 'bg-page/40'
                          : '';
                return (
                  <div
                    key={midi}
                    aria-hidden
                    className={`pointer-events-none absolute w-full border-b border-hairline/35 ${tint}`}
                    style={{ top: index * ROW_H, height: ROW_H }}
                  />
                );
              })}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={lineBackground}
              />

              {region.notes.map((note) => {
                const rowIndex = rowOf.get(note.midi);
                if (rowIndex === undefined || note.startBeat >= region.lengthBeats) return null;
                const isSelected = selected.has(note.id);
                const width = Math.max(
                  4,
                  Math.min(note.lengthBeats, region.lengthBeats - note.startBeat) * pxPerBeat - 1,
                );
                return (
                  <div
                    key={note.id}
                    role="button"
                    tabIndex={-1}
                    aria-label={`${midiName(note.midi)} at beat ${(note.startBeat + 1).toFixed(2)}`}
                    aria-pressed={isSelected}
                    onPointerDown={(e) => onNotePointerDown(e, note, false)}
                    className={`absolute cursor-grab rounded-[2px] border ${
                      isSelected
                        ? 'z-10 border-hi bg-accent-state'
                        : 'border-page/40 bg-accent-state/85'
                    }`}
                    style={{
                      left: note.startBeat * pxPerBeat,
                      top: rowIndex * ROW_H + 1,
                      width,
                      height: ROW_H - 2,
                      opacity: 0.4 + 0.6 * note.velocity,
                    }}
                  >
                    {width > 40 && ROW_H >= 12 ? (
                      <span className="numeric pointer-events-none absolute top-0 left-0.5 text-[8px] leading-[12px] text-page">
                        {midiName(note.midi)}
                      </span>
                    ) : null}
                    <div
                      role="presentation"
                      onPointerDown={(e) => onNotePointerDown(e, note, true)}
                      className="absolute top-0 right-0 h-full w-1.5 cursor-ew-resize"
                    />
                  </div>
                );
              })}

              {marquee !== null ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute z-20 border border-accent-state/80 bg-accent-state/10"
                  style={{
                    left: Math.min(marquee.x0, marquee.x1) * pxPerBeat,
                    width: Math.abs(marquee.x1 - marquee.x0) * pxPerBeat,
                    top: Math.min(marquee.y0, marquee.y1),
                    height: Math.abs(marquee.y1 - marquee.y0),
                  }}
                />
              ) : null}
              {playheadX !== null ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute top-0 z-20 h-full w-px bg-accent-live"
                  style={{ left: playheadX }}
                />
              ) : null}
            </div>
          </div>

          {/* velocity lane */}
          <div
            className="sticky bottom-0 z-20 flex border-t border-hairline bg-chrome-1"
            style={{ height: VEL_H }}
          >
            <div
              className="numeric sticky left-0 z-10 flex shrink-0 items-center justify-center border-r border-hairline bg-chrome-1 text-[8px] tracking-[0.14em] text-low uppercase"
              style={{ width: KEYS_W }}
            >
              Vel
            </div>
            <div
              ref={velRef}
              className="relative cursor-ns-resize touch-none"
              style={{ width: gridWidth }}
              onPointerDown={onVelocityPointerDown}
            >
              {region.notes.map((note) =>
                note.startBeat < region.lengthBeats ? (
                  <div
                    key={note.id}
                    aria-hidden
                    className={`pointer-events-none absolute bottom-0 w-[3px] rounded-t-[1px] ${
                      selected.has(note.id) ? 'bg-hi' : 'bg-accent-state/80'
                    }`}
                    style={{
                      left: note.startBeat * pxPerBeat + 1,
                      height: Math.max(2, note.velocity * (VEL_H - 6)),
                    }}
                  />
                ) : null,
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
