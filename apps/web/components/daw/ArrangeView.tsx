'use client';

/**
 * ArrangeView (Studio v2) — the Logic-style tracks area.
 *
 *  • Ruler: the cycle strip on top (drag empty = new cycle range, drag the
 *    range = move it, drag its edges = resize, click = cycle on/off) and the
 *    bar/beat strip below (click or drag = playhead).
 *  • Markers lane (double-click = add, click = jump, drag = move,
 *    double-click a marker = rename / delete).
 *  • Track headers: colour, kind icon, rename (double-click), mute / solo /
 *    record-arm, instrument picker, delete, drag the grip to reorder.
 *  • Regions (MIDI and audio): click / shift-click / marquee to select; drag
 *    to move (snapped; across lanes of the same kind; ⌥ copies; ⌘ ignores the
 *    grid); left edge trims (audio advances its file offset); lower-right edge
 *    trims; upper-right corner loops; double-click the name to rename,
 *    double-click a MIDI region to open it in the editor. Audio regions draw
 *    their waveform from the engine's peaks when available.
 *
 * Every drag commits pure editOps results from the drag's ORIGIN snapshot
 * with one coalesce key, so a whole gesture is a single undo step. Pointer
 * events only — mouse, pen and touch share one code path.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DawEngine, EngineSnapshot } from '@/lib/daw/engine';
import { trackAudible } from '@/lib/daw/engine';
import {
  INSTRUMENT_LABELS,
  newRegion,
  projectEndBeat,
  trackKind,
  type DawAudioRegion,
  type DawProject,
  type DawRegion,
  type DawTrack,
  type InstrumentId,
} from '@/lib/daw/types';
import {
  addMarker,
  allRegions,
  deleteMarker,
  deleteTrack,
  hasRef,
  loopRegionTo,
  markersOf,
  marqueeRefs,
  moveMarker,
  moveRegions,
  moveTrack,
  regionName,
  renameMarker,
  renameRegion,
  renameTrack,
  setTrackColor,
  snapBeat,
  snapBeats,
  SNAP_OPTIONS,
  toggleRef,
  trackColor,
  TRACK_COLORS,
  trimRegion,
  type AnyRegion,
  type RegionRef,
} from '@/lib/daw/editOps';
import { durationOf, engineExtras, settle, toPeaks } from '@/lib/daw/engineAdapter';
import {
  TRACK_H_MAX,
  TRACK_H_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
  type CommitFn,
  type RecordingInfo,
  type UpdateFn,
  type ViewState,
} from './DawApp';

const HEADER_W = 176;
const CYCLE_H = 12;
const NUMBERS_H = 18;
const MARKERS_H = 18;
const TOP_H = CYCLE_H + NUMBERS_H + MARKERS_H;
const INSTRUMENTS: readonly InstrumentId[] = ['oud', 'durbaan', 'bass', 'keys'];

let dragCounter = 0;
function nextDragKey(prefix: string): string {
  dragCounter += 1;
  return `${prefix}:${dragCounter}`;
}

/** Window-level drag: robust to re-renders and to leaving the element. */
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

export function ArrangeView({
  project,
  engine,
  transport,
  selection,
  selectedTrackId,
  view,
  recording,
  quantizeStrength,
  onSelect,
  onSelectTrack,
  onOpenEditor,
  onCommit,
  onUpdate,
  onViewChange,
  onSeek,
  onAddMidiTrack,
  onAddAudioTrack,
  onSplit,
  onDuplicate,
  onJoin,
  onDelete,
  onLoop,
  onQuantize,
  onQuantizeStrength,
}: {
  project: DawProject;
  engine: DawEngine;
  transport: EngineSnapshot;
  selection: RegionRef[];
  selectedTrackId: string | null;
  view: ViewState;
  recording: RecordingInfo | null;
  quantizeStrength: number;
  onSelect: (refs: RegionRef[]) => void;
  onSelectTrack: (trackId: string) => void;
  onOpenEditor: () => void;
  onCommit: CommitFn;
  onUpdate: UpdateFn;
  onViewChange: (patch: Partial<ViewState>) => void;
  onSeek: (beat: number) => void;
  onAddMidiTrack: (instrument: InstrumentId) => void;
  onAddAudioTrack: () => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onJoin: () => void;
  onDelete: () => void;
  onLoop: (delta: number) => void;
  onQuantize: () => void;
  onQuantizeStrength: (strength: number) => void;
}): React.JSX.Element {
  const { pxPerBeat, trackHeight } = view;
  const [marquee, setMarquee] = useState<{ x0: number; x1: number; y0: number; y1: number } | null>(
    null,
  );
  const [renaming, setRenaming] = useState<RegionRef | null>(null);
  const [renamingTrack, setRenamingTrack] = useState<string | null>(null);
  const [editingMarker, setEditingMarker] = useState<string | null>(null);
  const [colorFor, setColorFor] = useState<string | null>(null);
  const [reorder, setReorder] = useState<{ from: number; to: number } | null>(null);
  const [addMenu, setAddMenu] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const zoomAnchor = useRef<{ beat: number; offsetX: number } | null>(null);
  const viewRef = useRef(view);

  const beatsPerBar = project.timeSignature.beatsPerBar;
  const secPerBeat = 60 / project.bpm;
  const grid = snapBeats(view.snap, project.timeSignature);
  const totalBeats = Math.max(projectEndBeat(project) + beatsPerBar * 8, beatsPerBar * 32);
  const width = totalBeats * pxPerBeat;
  const lanesH = project.tracks.length * trackHeight;
  const selectedRefs = selection;
  const hasMidiSelected = selection.some((ref) =>
    project.tracks.find((t) => t.id === ref.trackId)?.regions.some((r) => r.id === ref.regionId),
  );
  const loopShown = selection.length === 1 ? findLoopCount(project, selection[0]) : null;

  useEffect(() => {
    viewRef.current = view;
  });

  // Imperative playhead (no React churn at 30 Hz) + follow while playing.
  useEffect(() => {
    const x = transport.beat * pxPerBeat;
    if (playheadRef.current) playheadRef.current.style.transform = `translateX(${x}px)`;
    const scroller = scrollRef.current;
    if (scroller && transport.state === 'playing') {
      const visible = scroller.clientWidth - HEADER_W;
      if (x > scroller.scrollLeft + visible - 24 || x < scroller.scrollLeft) {
        scroller.scrollLeft = Math.max(0, x - 48);
      }
    }
  }, [transport.beat, transport.state, pxPerBeat]);

  // Keep the beat under the cursor fixed while zooming.
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    const scroller = scrollRef.current;
    if (!anchor || !scroller) return;
    zoomAnchor.current = null;
    scroller.scrollLeft = Math.max(0, anchor.beat * pxPerBeat - anchor.offsetX);
  }, [pxPerBeat]);

  // ⌃/⌘-wheel and trackpad pinch = zoom; ⌥-wheel = track height.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onWheel = (e: WheelEvent): void => {
      const current = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = scroller.getBoundingClientRect();
        const offsetX = e.clientX - rect.left - HEADER_W;
        const beat = (scroller.scrollLeft + offsetX) / current.pxPerBeat;
        const next = Math.min(
          ZOOM_MAX,
          Math.max(ZOOM_MIN, current.pxPerBeat * Math.exp(-e.deltaY * 0.01)),
        );
        zoomAnchor.current = { beat, offsetX };
        onViewChange({ pxPerBeat: Math.round(next * 100) / 100 });
      } else if (e.altKey) {
        e.preventDefault();
        const next = Math.min(
          TRACK_H_MAX,
          Math.max(TRACK_H_MIN, current.trackHeight - Math.sign(e.deltaY) * 6),
        );
        onViewChange({ trackHeight: next });
      }
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, [onViewChange]);

  // ── coordinates ───────────────────────────────────────────────────────────
  const beatAt = (clientX: number): number => {
    const scroller = scrollRef.current;
    if (!scroller) return 0;
    const rect = scroller.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left + scroller.scrollLeft - HEADER_W) / pxPerBeat);
  };
  const laneYAt = (clientY: number): number => {
    const scroller = scrollRef.current;
    if (!scroller) return 0;
    const rect = scroller.getBoundingClientRect();
    return clientY - rect.top + scroller.scrollTop - TOP_H;
  };
  const trackIndexAt = (clientY: number): number =>
    Math.max(0, Math.min(project.tracks.length - 1, Math.floor(laneYAt(clientY) / trackHeight)));
  const snapFor = (beat: number, ev: { metaKey: boolean; ctrlKey: boolean }): number =>
    ev.metaKey || ev.ctrlKey ? beat : snapBeat(beat, grid);

  // ── ruler: cycle strip ────────────────────────────────────────────────────
  const onCyclePointerDown = (e: React.PointerEvent): void => {
    e.preventDefault();
    const anchor = beatAt(e.clientX);
    const { startBeat, endBeat } = project.loop;
    const edgeBeats = 6 / pxPerBeat;
    const key = nextDragKey('cycle');
    const cycleGrid = grid ?? 1;
    let mode: 'new' | 'move' | 'start' | 'end' = 'new';
    if (Math.abs(anchor - startBeat) < edgeBeats) mode = 'start';
    else if (Math.abs(anchor - endBeat) < edgeBeats) mode = 'end';
    else if (anchor > startBeat && anchor < endBeat) mode = 'move';
    startDrag(
      e,
      (ev) => {
        const beat = beatAt(ev.clientX);
        let s = startBeat;
        let en = endBeat;
        if (mode === 'new') {
          s = snapBeat(Math.min(anchor, beat), cycleGrid);
          en = snapBeat(Math.max(anchor, beat), cycleGrid);
        } else if (mode === 'move') {
          const delta = snapBeat(beat - anchor, cycleGrid);
          const shift = Math.max(-startBeat, delta);
          s = startBeat + shift;
          en = endBeat + shift;
        } else if (mode === 'start') {
          s = Math.min(snapBeat(beat, cycleGrid), endBeat - cycleGrid);
        } else {
          en = Math.max(snapBeat(beat, cycleGrid), startBeat + cycleGrid);
        }
        if (en - s < cycleGrid) en = s + cycleGrid;
        onUpdate((draft) => {
          draft.loop = { enabled: true, startBeat: Math.max(0, s), endBeat: en };
        }, key);
      },
      (_ev, moved) => {
        if (!moved && mode !== 'new') {
          onUpdate((draft) => {
            draft.loop.enabled = !draft.loop.enabled;
          });
        }
      },
    );
  };

  // ── ruler: playhead strip ─────────────────────────────────────────────────
  const onNumbersPointerDown = (e: React.PointerEvent): void => {
    e.preventDefault();
    const target = (ev: { clientX: number; metaKey: boolean; ctrlKey: boolean }): number =>
      snapFor(beatAt(ev.clientX), ev);
    onSeek(target(e));
    startDrag(
      e,
      (ev) => {
        if (transport.state === 'stopped') onSeek(target(ev));
      },
      (ev, moved) => {
        if (moved) onSeek(target(ev));
      },
    );
  };

  // ── markers lane ──────────────────────────────────────────────────────────
  const onMarkerPointerDown = (e: React.PointerEvent, markerId: string, beat: number): void => {
    e.stopPropagation();
    e.preventDefault();
    const origin = project;
    const key = nextDragKey('marker');
    const grab = beatAt(e.clientX) - beat;
    startDrag(
      e,
      (ev) => onCommit(moveMarker(origin, markerId, snapFor(beatAt(ev.clientX) - grab, ev)), key),
      (_ev, moved) => {
        if (!moved) onSeek(beat);
      },
    );
  };

  // ── regions ───────────────────────────────────────────────────────────────
  const onRegionPointerDown = (e: React.PointerEvent, ref: RegionRef, region: AnyRegion): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (e.shiftKey) {
      onSelect(toggleRef(selection, ref));
      return;
    }
    const already = hasRef(selection, ref);
    const refs = already ? selection : [ref];
    if (!already) onSelect([ref]);
    onSelectTrack(ref.trackId);
    const origin = project;
    const grabBeat = beatAt(e.clientX);
    const grabTrack = trackIndexAt(e.clientY);
    const key = nextDragKey('move');
    const copy = e.altKey;
    startDrag(
      e,
      (ev) => {
        const newStart = snapFor(region.startBeat + beatAt(ev.clientX) - grabBeat, ev);
        const result = moveRegions(
          origin,
          refs,
          newStart - region.startBeat,
          trackIndexAt(ev.clientY) - grabTrack,
          { copy },
        );
        onCommit(result.project, key);
        onSelect(result.selection);
      },
      (_ev, moved) => {
        if (!moved && already && selection.length > 1) onSelect([ref]);
      },
    );
  };

  const onEdgePointerDown = (
    e: React.PointerEvent,
    ref: RegionRef,
    mode: 'left' | 'right' | 'loop',
  ): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!hasRef(selection, ref)) onSelect([ref]);
    const origin = project;
    const key = nextDragKey(mode);
    startDrag(e, (ev) => {
      const beat = snapFor(beatAt(ev.clientX), ev);
      onCommit(
        mode === 'loop'
          ? loopRegionTo(origin, ref, beat)
          : trimRegion(origin, ref, mode, beat, {
              secPerBeat,
              minBeats: Math.min(grid ?? 0.25, beatsPerBar),
            }),
        key,
      );
    });
  };

  // ── empty lane: marquee / create ──────────────────────────────────────────
  const onLanePointerDown = (e: React.PointerEvent, track: DawTrack): void => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    onSelectTrack(track.id);
    setColorFor(null);
    const x0 = beatAt(e.clientX);
    const y0 = laneYAt(e.clientY);
    const additive = e.shiftKey;
    const base = additive ? selection : [];
    startDrag(
      e,
      (ev) => {
        const x1 = beatAt(ev.clientX);
        const y1 = laneYAt(ev.clientY);
        setMarquee({ x0, x1, y0, y1 });
        const t0 = Math.floor(Math.max(0, Math.min(y0, y1)) / trackHeight);
        const t1 = Math.floor(Math.max(0, Math.max(y0, y1)) / trackHeight);
        const hits = marqueeRefs(project, {
          startBeat: x0,
          endBeat: x1,
          firstTrack: t0,
          lastTrack: t1,
        });
        onSelect([...base, ...hits.filter((h) => !hasRef(base, h))]);
      },
      (_ev, moved) => {
        setMarquee(null);
        if (!moved && !additive) onSelect([]);
      },
    );
  };

  const onLaneDoubleClick = (e: React.MouseEvent, track: DawTrack): void => {
    if (e.target !== e.currentTarget || trackKind(track) !== 'midi') return;
    const start = Math.floor(beatAt(e.clientX) / beatsPerBar) * beatsPerBar;
    const region = newRegion(start, beatsPerBar);
    onUpdate((draft) => {
      draft.tracks.find((t) => t.id === track.id)?.regions.push(region);
    });
    onSelect([{ trackId: track.id, regionId: region.id }]);
    onOpenEditor();
  };

  // ── track reorder (grip drag) ─────────────────────────────────────────────
  const onGripPointerDown = (e: React.PointerEvent, from: number): void => {
    e.preventDefault();
    e.stopPropagation();
    const target = (clientY: number): number =>
      Math.max(0, Math.min(project.tracks.length, Math.round(laneYAt(clientY) / trackHeight)));
    startDrag(
      e,
      (ev) => setReorder({ from, to: target(ev.clientY) }),
      (ev, moved) => {
        setReorder(null);
        if (!moved) return;
        const to = target(ev.clientY);
        const dest = to > from ? to - 1 : to;
        if (dest !== from) onCommit(moveTrack(project, from, dest));
      },
    );
  };

  // ── render helpers ────────────────────────────────────────────────────────
  const barPx = beatsPerBar * pxPerBeat;
  const labelEvery = Math.max(1, Math.ceil(36 / barPx));
  const gridBackground = {
    backgroundImage: [
      'linear-gradient(90deg, var(--hairline) 0 1px, transparent 1px)',
      pxPerBeat >= 10
        ? 'linear-gradient(90deg, color-mix(in srgb, var(--hairline) 45%, transparent) 0 1px, transparent 1px)'
        : 'none',
    ].join(', '),
    backgroundSize: `${barPx}px 100%, ${pxPerBeat}px 100%`,
  };
  const markers = markersOf(project);

  return (
    <div className="flex h-full flex-col">
      {/* ── toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-hairline bg-chrome-1 px-2">
        <label className="numeric flex shrink-0 items-center gap-1 text-[9px] tracking-[0.14em] text-low uppercase">
          Snap
          <select
            value={view.snap}
            onChange={(e) => {
              const snap = SNAP_OPTIONS.find((o) => o.value === e.target.value)?.value;
              if (snap) onViewChange({ snap });
            }}
            className="numeric h-6 rounded-[3px] border border-hairline bg-chrome-2 px-1 text-[11px] tracking-normal text-hi normal-case outline-none focus:border-accent-state"
          >
            {SNAP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <ToolGroup>
          <ToolButton
            label="−"
            aria="Zoom out (⌘−)"
            onClick={() => onViewChange({ pxPerBeat: Math.max(ZOOM_MIN, pxPerBeat * 0.8) })}
          />
          <span className="numeric px-0.5 text-[9px] text-low">zoom</span>
          <ToolButton
            label="+"
            aria="Zoom in (⌘+)"
            onClick={() => onViewChange({ pxPerBeat: Math.min(ZOOM_MAX, pxPerBeat * 1.25) })}
          />
        </ToolGroup>
        <ToolGroup>
          <ToolButton
            label="−"
            aria="Shorter tracks (⌥ scroll)"
            onClick={() => onViewChange({ trackHeight: Math.max(TRACK_H_MIN, trackHeight - 12) })}
          />
          <span className="numeric px-0.5 text-[9px] text-low">height</span>
          <ToolButton
            label="+"
            aria="Taller tracks (⌥ scroll)"
            onClick={() => onViewChange({ trackHeight: Math.min(TRACK_H_MAX, trackHeight + 12) })}
          />
        </ToolGroup>
        <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-hairline" />
        {selectedRefs.length > 0 ? (
          <>
            <ToolButton label="Split" aria="Split at playhead (⌘T / S)" onClick={onSplit} />
            <ToolButton label="Dup" aria="Duplicate after (⌘D)" onClick={onDuplicate} />
            {selectedRefs.length > 1 ? (
              <ToolButton label="Join" aria="Join MIDI regions (⌘J)" onClick={onJoin} />
            ) : null}
            <ToolGroup>
              <ToolButton label="−" aria="Loop one pass fewer" onClick={() => onLoop(-1)} />
              <span className="numeric px-0.5 text-[9px] text-low">
                loop{loopShown !== null ? ` ×${loopShown}` : ''}
              </span>
              <ToolButton label="+" aria="Loop one pass more" onClick={() => onLoop(1)} />
            </ToolGroup>
            {hasMidiSelected ? (
              <ToolGroup>
                <ToolButton
                  label="Quantize"
                  aria="Quantize notes to the snap grid (Q)"
                  onClick={onQuantize}
                />
                <StrengthSelect value={quantizeStrength} onChange={onQuantizeStrength} />
              </ToolGroup>
            ) : null}
            {selectedRefs.length === 1 && selectedRefs[0] ? (
              <ToolButton
                label="Rename"
                aria="Rename region"
                onClick={() => setRenaming(selectedRefs[0] ?? null)}
              />
            ) : null}
            <ToolButton label="Delete" aria="Delete (⌫)" onClick={onDelete} danger />
          </>
        ) : (
          <span className="numeric shrink-0 text-[9px] tracking-[0.14em] text-low uppercase">
            drag lane = select · dbl-click lane = new region · ⌥M marker · ? help
          </span>
        )}
        <div className="relative ml-auto shrink-0">
          <ToolButton label="+ Track" aria="Add a track" onClick={() => setAddMenu((v) => !v)} />
          {addMenu ? (
            <AddTrackMenu
              onPick={(choice) => {
                setAddMenu(false);
                if (choice === 'audio') onAddAudioTrack();
                else onAddMidiTrack(choice);
              }}
              onClose={() => setAddMenu(false)}
            />
          ) : null}
        </div>
      </div>

      {/* ── scrolling canvas ────────────────────────────────────────────── */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto overscroll-contain">
        <div style={{ width: width + HEADER_W }} className="relative">
          {/* ruler + markers (sticky) */}
          <div
            className="sticky top-0 z-30 flex border-b border-hairline bg-chrome-1"
            style={{ height: TOP_H }}
          >
            <div
              className="numeric sticky left-0 z-10 flex shrink-0 flex-col justify-end border-r border-hairline bg-chrome-1 px-2 pb-0.5 text-[9px] tracking-[0.14em] text-low uppercase"
              style={{ width: HEADER_W }}
            >
              <span>
                {project.tracks.length} tracks ·{' '}
                {view.snap === 'off' ? 'no snap' : `snap ${view.snap}`}
              </span>
              <span>markers</span>
            </div>
            <div className="relative flex-1">
              {/* cycle strip */}
              <div
                className="absolute inset-x-0 top-0 cursor-pointer touch-none"
                style={{ height: CYCLE_H }}
                onPointerDown={onCyclePointerDown}
                title="Drag to set the cycle range · click it to toggle cycle (C)"
              >
                {project.loop.endBeat > project.loop.startBeat ? (
                  <div
                    className={`absolute top-0.5 bottom-0.5 rounded-[2px] border ${
                      project.loop.enabled
                        ? 'border-accent-state bg-accent-state/45'
                        : 'border-hairline bg-chrome-2'
                    }`}
                    style={{
                      left: project.loop.startBeat * pxPerBeat,
                      width: (project.loop.endBeat - project.loop.startBeat) * pxPerBeat,
                    }}
                  />
                ) : null}
              </div>
              {/* bars + beats */}
              <div
                className="absolute inset-x-0 cursor-text touch-none border-t border-hairline/60"
                style={{ top: CYCLE_H, height: NUMBERS_H, ...gridBackground }}
                onPointerDown={onNumbersPointerDown}
              >
                {Array.from({ length: Math.ceil(totalBeats / beatsPerBar) }, (_, barIndex) =>
                  barIndex % labelEvery === 0 ? (
                    <span
                      key={barIndex}
                      className="numeric pointer-events-none absolute top-0.5 text-[10px] text-mid select-none"
                      style={{ left: barIndex * barPx + 3 }}
                    >
                      {barIndex + 1}
                    </span>
                  ) : null,
                )}
              </div>
              {/* markers */}
              <div
                className="absolute inset-x-0 border-t border-hairline/60 bg-page/40"
                style={{ top: CYCLE_H + NUMBERS_H, height: MARKERS_H }}
                onDoubleClick={(e) => {
                  if (e.target !== e.currentTarget) return;
                  onCommit(addMarker(project, snapFor(beatAt(e.clientX), e)).project);
                }}
                title="Double-click to add a marker (⌥M at the playhead)"
              >
                {markers.map((marker) => (
                  <div
                    key={marker.id}
                    className="absolute top-0 flex h-full items-center"
                    style={{ left: marker.beat * pxPerBeat }}
                  >
                    {editingMarker === marker.id ? (
                      <span className="flex items-center gap-0.5">
                        <input
                          autoFocus
                          defaultValue={marker.name}
                          maxLength={60}
                          aria-label="Marker name"
                          onBlur={(e) => {
                            onCommit(renameMarker(project, marker.id, e.target.value));
                            setEditingMarker(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') setEditingMarker(null);
                          }}
                          className="h-4 w-28 rounded-[2px] border border-accent-state bg-chrome-2 px-1 text-[10px] text-hi outline-none"
                        />
                        <button
                          type="button"
                          aria-label={`Delete marker ${marker.name}`}
                          onPointerDown={(e) => e.preventDefault()}
                          onClick={() => {
                            onCommit(deleteMarker(project, marker.id));
                            setEditingMarker(null);
                          }}
                          className="h-4 rounded-[2px] border border-hairline px-1 text-[9px] text-low hover:border-danger hover:text-danger"
                        >
                          ✕
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        title={`${marker.name} — click to jump, drag to move, double-click to rename`}
                        onPointerDown={(e) => onMarkerPointerDown(e, marker.id, marker.beat)}
                        onDoubleClick={() => setEditingMarker(marker.id)}
                        className="flex h-[14px] max-w-40 touch-none items-center gap-1 truncate rounded-r-[3px] border-l-2 border-accent-state bg-accent-state/20 pr-1.5 pl-1 text-[10px] text-hi hover:bg-accent-state/35"
                      >
                        {marker.name}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {/* ruler playhead cap */}
              <div
                aria-hidden
                className="pointer-events-none absolute top-0 h-full w-px bg-accent-live"
                style={{ transform: `translateX(${transport.beat * pxPerBeat}px)` }}
              />
            </div>
          </div>

          {/* ── track rows ─────────────────────────────────────────────── */}
          {project.tracks.map((track, index) => {
            const audible = trackAudible(project, track);
            const color = trackColor(track, index);
            const kind = trackKind(track);
            const isSelectedTrack = selectedTrackId === track.id;
            const recordingHere = recording?.trackIds.includes(track.id) ?? false;
            return (
              <div
                key={track.id}
                className="flex border-b border-hairline"
                style={{ height: trackHeight }}
              >
                {/* header */}
                <div
                  className={`sticky left-0 flex shrink-0 border-r border-hairline ${
                    colorFor === track.id ? 'z-40' : 'z-20'
                  } ${isSelectedTrack ? 'bg-chrome-2' : 'bg-chrome-1'}`}
                  style={{ width: HEADER_W }}
                  onPointerDown={() => onSelectTrack(track.id)}
                >
                  <button
                    type="button"
                    aria-label={`Colour of ${track.name}`}
                    title="Track colour"
                    onClick={() => setColorFor(colorFor === track.id ? null : track.id)}
                    className="w-1.5 shrink-0"
                    style={{ background: color }}
                  />
                  <div
                    role="presentation"
                    title="Drag to reorder"
                    onPointerDown={(e) => onGripPointerDown(e, index)}
                    className="flex w-3 shrink-0 cursor-grab touch-none items-center justify-center text-[9px] text-low hover:text-hi"
                  >
                    ⋮
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-1 pr-1.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <KindIcon kind={kind} color={color} />
                      {renamingTrack === track.id ? (
                        <input
                          autoFocus
                          defaultValue={track.name}
                          maxLength={40}
                          aria-label="Track name"
                          onBlur={(e) => {
                            onCommit(renameTrack(project, track.id, e.target.value));
                            setRenamingTrack(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') setRenamingTrack(null);
                          }}
                          className="h-5 min-w-0 flex-1 rounded-[2px] border border-accent-state bg-chrome-2 px-1 text-xs text-hi outline-none"
                        />
                      ) : (
                        <span
                          onDoubleClick={() => setRenamingTrack(track.id)}
                          title="Double-click to rename"
                          className={`min-w-0 flex-1 cursor-default truncate text-xs font-semibold select-none ${
                            audible ? 'text-hi' : 'text-low'
                          }`}
                        >
                          {track.name}
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label={`Delete track ${track.name}`}
                        title="Delete track (undo with ⌘Z)"
                        onClick={() => onCommit(deleteTrack(project, track.id))}
                        className="shrink-0 px-0.5 text-[10px] text-low opacity-60 hover:text-danger hover:opacity-100"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="flex items-center gap-1">
                      <MiniToggle
                        label="M"
                        active={track.muted}
                        aria={`Mute ${track.name}`}
                        onClick={() =>
                          onUpdate((draft) => {
                            const t = draft.tracks.find((x) => x.id === track.id);
                            if (t) t.muted = !t.muted;
                          })
                        }
                      />
                      <MiniToggle
                        label="S"
                        active={track.solo}
                        aria={`Solo ${track.name}`}
                        onClick={() =>
                          onUpdate((draft) => {
                            const t = draft.tracks.find((x) => x.id === track.id);
                            if (t) t.solo = !t.solo;
                          })
                        }
                      />
                      <MiniToggle
                        label="●"
                        active={track.armed}
                        danger
                        aria={`Record-arm ${track.name}`}
                        onClick={() =>
                          onUpdate((draft) => {
                            const t = draft.tracks.find((x) => x.id === track.id);
                            if (t) t.armed = !t.armed;
                          })
                        }
                      />
                      {kind === 'midi' && trackHeight >= 48 ? (
                        <select
                          aria-label={`Instrument for ${track.name}`}
                          value={track.instrument}
                          onChange={(e) => {
                            const instrument = INSTRUMENTS.find((i) => i === e.target.value);
                            if (!instrument) return;
                            onUpdate((draft) => {
                              const t = draft.tracks.find((x) => x.id === track.id);
                              if (t) t.instrument = instrument;
                            });
                          }}
                          className="numeric ml-auto h-5 min-w-0 rounded-[3px] border border-hairline bg-chrome-2 px-0.5 text-[9px] text-mid outline-none"
                        >
                          {INSTRUMENTS.map((i) => (
                            <option key={i} value={i}>
                              {INSTRUMENT_LABELS[i]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="numeric ml-auto truncate text-[9px] tracking-wide text-low uppercase">
                          {kind === 'audio' ? 'Audio' : INSTRUMENT_LABELS[track.instrument]}
                        </span>
                      )}
                    </div>
                  </div>
                  {colorFor === track.id ? (
                    <div className="absolute top-full left-2 z-40 mt-0.5 grid grid-cols-4 gap-1 rounded-[4px] border border-hairline bg-chrome-2 p-1.5 shadow-xl">
                      {TRACK_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-label={`Colour ${c}`}
                          onClick={() => {
                            onCommit(setTrackColor(project, track.id, c));
                            setColorFor(null);
                          }}
                          className={`h-5 w-5 rounded-[3px] border ${
                            c === color ? 'border-hi' : 'border-transparent'
                          }`}
                          style={{ background: c }}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* lane */}
                <div
                  className={`relative flex-1 touch-pan-x touch-pan-y ${audible ? '' : 'opacity-45'} ${
                    isSelectedTrack ? 'bg-chrome-1/40' : ''
                  }`}
                  style={gridBackground}
                  onPointerDown={(e) => onLanePointerDown(e, track)}
                  onDoubleClick={(e) => onLaneDoubleClick(e, track)}
                >
                  {allRegions(track).map((region) => {
                    const ref = { trackId: track.id, regionId: region.id };
                    return (
                      <RegionBlock
                        key={region.id}
                        engine={engine}
                        region={region}
                        fallbackName={track.name}
                        color={color}
                        selected={hasRef(selection, ref)}
                        pxPerBeat={pxPerBeat}
                        height={trackHeight}
                        secPerBeat={secPerBeat}
                        renaming={renaming !== null && renaming.regionId === region.id}
                        onPointerDown={(e) => onRegionPointerDown(e, ref, region)}
                        onEdgePointerDown={(e, mode) => onEdgePointerDown(e, ref, mode)}
                        onOpen={() => {
                          if (region.kind === 'midi') onOpenEditor();
                        }}
                        onStartRename={() => setRenaming(ref)}
                        onRename={(name) => {
                          setRenaming(null);
                          if (name !== null) onCommit(renameRegion(project, ref, name));
                        }}
                      />
                    );
                  })}
                  {recordingHere && recording ? (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute top-0.5 bottom-0.5 rounded-[3px] border border-danger bg-danger/20"
                      style={{
                        left: recording.startBeat * pxPerBeat,
                        width: Math.max(2, (transport.beat - recording.startBeat) * pxPerBeat),
                      }}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}

          {/* add track row */}
          <div
            className="sticky left-0 flex items-center gap-1.5 px-2 py-2"
            style={{ width: HEADER_W + 360 }}
          >
            <span className="numeric text-[9px] tracking-[0.14em] text-low uppercase">Add</span>
            {INSTRUMENTS.map((instrument) => (
              <button
                key={instrument}
                type="button"
                onClick={() => onAddMidiTrack(instrument)}
                className="rounded-[3px] border border-dashed border-hairline px-2 py-1 text-[11px] text-low hover:border-accent-state hover:text-accent-state"
              >
                {INSTRUMENT_LABELS[instrument]}
              </button>
            ))}
            <button
              type="button"
              onClick={onAddAudioTrack}
              className="rounded-[3px] border border-dashed border-hairline px-2 py-1 text-[11px] text-low hover:border-accent-state hover:text-accent-state"
            >
              Audio track
            </button>
          </div>

          {/* reorder indicator */}
          {reorder !== null ? (
            <div
              aria-hidden
              className="pointer-events-none absolute right-0 left-0 z-30 h-0.5 bg-accent-state"
              style={{ top: TOP_H + reorder.to * trackHeight - 1 }}
            />
          ) : null}

          {/* marquee */}
          {marquee !== null ? (
            <div
              aria-hidden
              className="pointer-events-none absolute z-20 border border-accent-state/80 bg-accent-state/10"
              style={{
                left: HEADER_W + Math.min(marquee.x0, marquee.x1) * pxPerBeat,
                width: Math.abs(marquee.x1 - marquee.x0) * pxPerBeat,
                top: TOP_H + Math.max(0, Math.min(marquee.y0, marquee.y1)),
                height: Math.min(lanesH, Math.abs(marquee.y1 - marquee.y0)),
              }}
            />
          ) : null}

          {/* playhead */}
          <div
            ref={playheadRef}
            aria-hidden
            className="pointer-events-none absolute bottom-0 z-10 w-px bg-accent-live"
            style={{ left: HEADER_W, top: TOP_H }}
          />
        </div>
      </div>
    </div>
  );
}

function findLoopCount(project: DawProject, ref: RegionRef | undefined): number | null {
  if (!ref) return null;
  const track = project.tracks.find((t) => t.id === ref.trackId);
  const region = track ? allRegions(track).find((r) => r.id === ref.regionId) : undefined;
  return region?.loopCount ?? null;
}

// ── region block ────────────────────────────────────────────────────────────

function RegionBlock({
  engine,
  region,
  fallbackName,
  color,
  selected,
  pxPerBeat,
  height,
  secPerBeat,
  renaming,
  onPointerDown,
  onEdgePointerDown,
  onOpen,
  onStartRename,
  onRename,
}: {
  engine: DawEngine;
  region: AnyRegion;
  fallbackName: string;
  color: string;
  selected: boolean;
  pxPerBeat: number;
  height: number;
  secPerBeat: number;
  renaming: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onEdgePointerDown: (e: React.PointerEvent, mode: 'left' | 'right' | 'loop') => void;
  onOpen: () => void;
  onStartRename: () => void;
  onRename: (name: string | null) => void;
}): React.JSX.Element {
  const passPx = region.lengthBeats * pxPerBeat;
  const spanPx = passPx * region.loopCount;
  const name = regionName(region, fallbackName);
  const bodyH = Math.max(8, height - 4 - 14);
  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={`${region.kind === 'audio' ? 'Audio' : 'MIDI'} region ${name}`}
      aria-pressed={selected}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className="absolute top-0.5 bottom-0.5 cursor-grab touch-none overflow-hidden rounded-[3px] border active:cursor-grabbing"
      style={{
        left: region.startBeat * pxPerBeat,
        width: Math.max(4, spanPx),
        borderColor: selected ? 'var(--text-hi)' : `${color}cc`,
        background: selected ? `${color}55` : `${color}2b`,
        boxShadow: selected ? `0 0 0 1px ${color}` : undefined,
      }}
    >
      {/* name strip */}
      <div
        className="relative flex h-3.5 items-center overflow-hidden px-1"
        style={{ background: selected ? `${color}cc` : `${color}80` }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onStartRename();
        }}
      >
        {renaming ? (
          <input
            autoFocus
            defaultValue={name}
            maxLength={80}
            aria-label="Region name"
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={(e) => onRename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') onRename(null);
            }}
            className="h-3 w-full min-w-16 bg-page/80 px-0.5 text-[9px] text-hi outline-none"
          />
        ) : (
          <span className="truncate text-[9px] leading-none font-semibold text-page select-none">
            {name}
            {region.loopCount > 1 ? ` ×${region.loopCount}` : ''}
          </span>
        )}
      </div>

      {/* content, one copy per loop pass */}
      <div className="pointer-events-none relative" style={{ height: bodyH }}>
        {Array.from({ length: region.loopCount }, (_, pass) => (
          <div
            key={pass}
            className="absolute top-0 h-full"
            style={{
              left: pass * passPx,
              width: passPx,
              opacity: pass === 0 ? 1 : 0.5,
              borderLeft: pass > 0 ? `1px dashed ${color}` : undefined,
            }}
          >
            {region.kind === 'midi' ? (
              <MidiSketch region={region} pxPerBeat={pxPerBeat} height={bodyH} color={color} />
            ) : pass === 0 || region.loopCount < 32 ? (
              <Waveform
                engine={engine}
                region={region}
                pxPerBeat={pxPerBeat}
                secPerBeat={secPerBeat}
                height={bodyH}
                color={color}
              />
            ) : null}
          </div>
        ))}
      </div>

      {/* handles */}
      <div
        role="presentation"
        title="Trim start"
        onPointerDown={(e) => onEdgePointerDown(e, 'left')}
        className="absolute top-0 left-0 h-full w-1.5 cursor-ew-resize hover:bg-hi/30"
      />
      <div
        role="presentation"
        title="Trim end"
        onPointerDown={(e) => onEdgePointerDown(e, 'right')}
        className="absolute bottom-0 h-1/2 w-1.5 cursor-ew-resize hover:bg-hi/30"
        style={{ left: Math.max(0, passPx - 6) }}
      />
      <div
        role="presentation"
        title="Drag to loop"
        onPointerDown={(e) => onEdgePointerDown(e, 'loop')}
        className="absolute top-0 right-0 flex h-1/2 w-2.5 cursor-alias items-start justify-center text-[8px] leading-none text-page hover:bg-hi/30"
      >
        ↻
      </div>
    </div>
  );
}

function MidiSketch({
  region,
  pxPerBeat,
  height,
  color,
}: {
  region: DawRegion;
  pxPerBeat: number;
  height: number;
  color: string;
}): React.JSX.Element | null {
  const visible = region.notes.filter((n) => n.startBeat >= 0 && n.startBeat < region.lengthBeats);
  if (visible.length === 0) return null;
  let lo = 127;
  let hi = 0;
  for (const note of visible) {
    lo = Math.min(lo, note.midi);
    hi = Math.max(hi, note.midi);
  }
  const span = Math.max(1, hi - lo);
  const noteH = Math.max(1.5, Math.min(4, height / (span + 2)));
  return (
    <svg aria-hidden className="absolute inset-0 h-full w-full overflow-visible">
      {visible.map((note) => (
        <rect
          key={note.id}
          x={note.startBeat * pxPerBeat}
          y={2 + (1 - (note.midi - lo) / span) * Math.max(0, height - noteH - 4)}
          width={Math.max(
            1.5,
            Math.min(note.lengthBeats, region.lengthBeats - note.startBeat) * pxPerBeat - 1,
          )}
          height={noteH}
          fill={color}
          opacity={0.55 + 0.45 * note.velocity}
        />
      ))}
    </svg>
  );
}

/** Audio waveform from engine peaks; a placeholder bar until they exist. */
function Waveform({
  engine,
  region,
  pxPerBeat,
  secPerBeat,
  height,
  color,
}: {
  engine: DawEngine;
  region: DawAudioRegion;
  pxPerBeat: number;
  secPerBeat: number;
  height: number;
  color: string;
}): React.JSX.Element {
  const [loaded, setLoaded] = useState<{ source: string; duration: number | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const extras = engineExtras(engine);
    if (!extras.loadAudio) return;
    void settle(extras.loadAudio(region.source))
      .then((result) => {
        if (!cancelled) setLoaded({ source: region.source, duration: durationOf(result) });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [engine, region.source]);

  const passPx = region.lengthBeats * pxPerBeat;
  const passSec = region.lengthBeats * secPerBeat;
  const duration = loaded?.source === region.source ? loaded.duration : null;

  const path = useMemo((): string | null => {
    const extras = engineExtras(engine);
    if (!extras.getPeaks || passPx <= 0) return null;
    const visibleBuckets = Math.max(8, Math.min(2000, Math.round(passPx / 2)));
    const buckets =
      duration !== null
        ? Math.max(8, Math.min(20000, Math.ceil((visibleBuckets * duration) / passSec)))
        : visibleBuckets;
    const peaks = toPeaks(extras.getPeaks(region.source, buckets), buckets);
    if (!peaks) return null;
    const total = peaks.max.length;
    const from = duration !== null ? Math.floor((region.offsetSec / duration) * total) : 0;
    const to =
      duration !== null
        ? Math.min(total, Math.ceil(((region.offsetSec + passSec) / duration) * total))
        : total;
    const count = Math.max(1, to - from);
    const mid = height / 2;
    const amp = (height / 2 - 1) * Math.min(2, Math.max(0.2, region.gain));
    const top: string[] = [];
    const bottom: string[] = [];
    for (let i = 0; i < count; i++) {
      const x = ((i + 0.5) / count) * passPx;
      const hiV = peaks.max[from + i] ?? 0;
      const loV = peaks.min[from + i] ?? 0;
      top.push(`${x.toFixed(1)},${(mid - Math.min(1, hiV) * amp).toFixed(1)}`);
      bottom.push(`${x.toFixed(1)},${(mid - Math.max(-1, loV) * amp).toFixed(1)}`);
    }
    return `M0,${mid} L${top.join(' L')} L${passPx.toFixed(1)},${mid} L${bottom
      .reverse()
      .join(' L')} Z`;
    // `loaded` re-runs this once the engine has decoded the file.
  }, [engine, region.source, region.offsetSec, region.gain, passPx, passSec, height, duration]);

  if (path === null) {
    return (
      <div
        aria-hidden
        className="absolute inset-x-0 top-1/2 h-1/3 -translate-y-1/2 rounded-[2px]"
        style={{
          background: `repeating-linear-gradient(90deg, ${color}55 0 2px, transparent 2px 4px)`,
        }}
      />
    );
  }
  return (
    <svg aria-hidden className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
      <path d={path} fill={color} opacity={0.85} />
    </svg>
  );
}

// ── small parts ─────────────────────────────────────────────────────────────

function KindIcon({ kind, color }: { kind: 'midi' | 'audio'; color: string }): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      role="img"
      aria-label={kind === 'audio' ? 'Audio track' : 'MIDI track'}
      className="shrink-0"
      fill="none"
      stroke={color}
      strokeWidth="1.3"
      strokeLinecap="round"
    >
      {kind === 'audio' ? (
        <path d="M1 6h1M3 3.5v5M5 1.5v9M7 3v6M9 4.5v3M11 6h0" />
      ) : (
        <>
          <rect x="1" y="1.5" width="10" height="9" rx="1" />
          <path d="M4 1.5v5M8 1.5v5M6 6.5v4" />
        </>
      )}
    </svg>
  );
}

function AddTrackMenu({
  onPick,
  onClose,
}: {
  onPick: (choice: InstrumentId | 'audio') => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div
      className="absolute top-full right-0 z-50 mt-1 w-48 rounded-[4px] border border-hairline bg-chrome-2 p-1 shadow-xl"
      onPointerLeave={onClose}
    >
      <p className="numeric px-2 pt-1 pb-0.5 text-[9px] tracking-[0.14em] text-low uppercase">
        MIDI instrument
      </p>
      {INSTRUMENTS.map((instrument) => (
        <button
          key={instrument}
          type="button"
          onClick={() => onPick(instrument)}
          className="block w-full rounded-[3px] px-2 py-1 text-left text-xs text-mid hover:bg-chrome-1 hover:text-hi"
        >
          {INSTRUMENT_LABELS[instrument]}
        </button>
      ))}
      <p className="numeric px-2 pt-1.5 pb-0.5 text-[9px] tracking-[0.14em] text-low uppercase">
        Audio
      </p>
      <button
        type="button"
        onClick={() => onPick('audio')}
        className="block w-full rounded-[3px] px-2 py-1 text-left text-xs text-mid hover:bg-chrome-1 hover:text-hi"
      >
        Audio track (record / import)
      </button>
    </div>
  );
}

function StrengthSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (strength: number) => void;
}): React.JSX.Element {
  return (
    <select
      aria-label="Quantize strength"
      title="Quantize strength"
      value={Math.round(value * 100)}
      onChange={(e) => onChange(Number(e.target.value) / 100)}
      className="numeric h-6 rounded-[3px] border border-hairline bg-chrome-2 px-0.5 text-[10px] text-hi outline-none"
    >
      {[100, 90, 75, 50, 25].map((s) => (
        <option key={s} value={s}>
          {s}%
        </option>
      ))}
    </select>
  );
}

function ToolGroup({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flex shrink-0 items-center gap-0.5">{children}</div>;
}

export function ToolButton({
  label,
  onClick,
  aria,
  danger = false,
  active = false,
}: {
  label: string;
  onClick: () => void;
  aria: string;
  danger?: boolean;
  active?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={aria}
      title={aria}
      aria-pressed={active}
      onClick={onClick}
      className={`numeric h-6 shrink-0 rounded-[3px] border px-2 text-[10px] tracking-wide uppercase transition-colors ${
        active
          ? 'border-accent-state bg-accent-state/15 text-accent-state'
          : danger
            ? 'border-hairline text-low hover:border-danger hover:text-danger'
            : 'border-hairline text-mid hover:border-accent-state hover:text-hi'
      }`}
    >
      {label}
    </button>
  );
}

function MiniToggle({
  label,
  active,
  onClick,
  aria,
  danger = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  aria: string;
  danger?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={aria}
      title={aria}
      aria-pressed={active}
      onClick={onClick}
      className={`numeric h-5 w-5 shrink-0 rounded-[3px] border text-[9px] leading-none transition-colors ${
        active
          ? danger
            ? 'border-danger bg-danger/25 text-danger'
            : label === 'S'
              ? 'border-accent-state bg-accent-state text-page'
              : 'border-accent-live bg-accent-live/25 text-accent-live'
          : 'border-hairline text-low hover:text-hi'
      }`}
    >
      {label}
    </button>
  );
}
