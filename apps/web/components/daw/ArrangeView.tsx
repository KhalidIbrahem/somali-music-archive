'use client';

/**
 * ArrangeView (Stage 5 Tier 1) — the timeline: bar ruler (tap to seek, drag
 * to set the loop range), track headers (arm, mute, solo, add track), and
 * region lanes. Regions: drag to move (1-beat snap), right edge to trim,
 * and a selection toolbar for split-at-playhead, duplicate, loop ±, delete.
 * Pointer events only — mouse and touch share one code path.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DawEngine, EngineSnapshot } from '@/lib/daw/engine';
import {
  INSTRUMENT_LABELS,
  newRegion,
  projectEndBeat,
  type DawProject,
  type DawRegion,
  type InstrumentId,
} from '@/lib/daw/types';
import { trackAudible } from '@/lib/daw/engine';
import type { Selection } from './DawApp';

const HEADER_W = 132;
const LANE_H = 56;

type DragMode =
  | { kind: 'move'; trackId: string; regionId: string; grabOffsetBeats: number }
  | { kind: 'trim'; trackId: string; regionId: string }
  | { kind: 'loop-range'; anchorBeat: number };

export function ArrangeView({
  project,
  engine,
  transport,
  selection,
  onSelect,
  onUpdate,
  onAddTrack,
}: {
  project: DawProject;
  engine: DawEngine;
  transport: EngineSnapshot;
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  onUpdate: (mutate: (draft: DawProject) => void) => void;
  onAddTrack: (instrument: InstrumentId) => void;
}): React.JSX.Element {
  const [pxPerBeat, setPxPerBeat] = useState(28);
  const [adding, setAdding] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragMode | null>(null);
  const playheadRef = useRef<HTMLDivElement>(null);

  const beatsPerBar = project.timeSignature.beatsPerBar;
  const totalBeats = Math.max(projectEndBeat(project) + beatsPerBar * 4, beatsPerBar * 16);
  const width = totalBeats * pxPerBeat;

  // Imperative playhead — no React churn at 30 Hz.
  useEffect(() => {
    if (playheadRef.current) {
      playheadRef.current.style.transform = `translateX(${transport.beat * pxPerBeat}px)`;
    }
  }, [transport.beat, pxPerBeat]);

  const beatAt = useCallback(
    (clientX: number): number => {
      const scroller = scrollRef.current;
      if (!scroller) return 0;
      const rect = scroller.getBoundingClientRect();
      const x = clientX - rect.left + scroller.scrollLeft - HEADER_W;
      return Math.max(0, x / pxPerBeat);
    },
    [pxPerBeat],
  );

  const snap = useCallback((beat: number): number => Math.round(beat), []);

  // ── ruler: tap = seek, horizontal drag = loop range ───────────────────────
  const onRulerPointerDown = (e: React.PointerEvent): void => {
    const anchor = beatAt(e.clientX);
    dragRef.current = { kind: 'loop-range', anchorBeat: anchor };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onRulerPointerMove = (e: React.PointerEvent): void => {
    const drag = dragRef.current;
    if (drag?.kind !== 'loop-range') return;
    const current = beatAt(e.clientX);
    if (Math.abs(current - drag.anchorBeat) < 0.5) return;
    const start = snap(Math.min(drag.anchorBeat, current));
    const end = Math.max(start + 1, snap(Math.max(drag.anchorBeat, current)));
    onUpdate((draft) => {
      draft.loop = { enabled: true, startBeat: start, endBeat: end };
    });
  };

  const onRulerPointerUp = (e: React.PointerEvent): void => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.kind !== 'loop-range') return;
    const current = beatAt(e.clientX);
    // A tap (no meaningful horizontal drag) seeks; a drag set the loop already.
    if (Math.abs(current - drag.anchorBeat) < 0.5) engine.seek(current);
  };

  // ── region drags ──────────────────────────────────────────────────────────
  const onRegionPointerDown = (
    e: React.PointerEvent,
    trackId: string,
    region: DawRegion,
    edge: boolean,
  ): void => {
    e.stopPropagation();
    onSelect({ trackId, regionId: region.id });
    dragRef.current = edge
      ? { kind: 'trim', trackId, regionId: region.id }
      : {
          kind: 'move',
          trackId,
          regionId: region.id,
          grabOffsetBeats: beatAt(e.clientX) - region.startBeat,
        };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onLanePointerMove = (e: React.PointerEvent): void => {
    const drag = dragRef.current;
    if (!drag || drag.kind === 'loop-range') return;
    const beat = beatAt(e.clientX);
    onUpdate((draft) => {
      const track = draft.tracks.find((t) => t.id === drag.trackId);
      const region = track?.regions.find((r) => r.id === drag.regionId);
      if (!region) return;
      if (drag.kind === 'move') {
        region.startBeat = Math.max(0, snap(beat - drag.grabOffsetBeats));
      } else {
        region.lengthBeats = Math.max(1, snap(beat - region.startBeat));
      }
    });
  };

  const onLanePointerUp = (): void => {
    if (dragRef.current && dragRef.current.kind !== 'loop-range') dragRef.current = null;
  };

  const onLaneDoubleClick = (trackId: string, e: React.MouseEvent): void => {
    const start = Math.floor(beatAt(e.clientX) / beatsPerBar) * beatsPerBar;
    const region = newRegion(start, beatsPerBar);
    onUpdate((draft) => {
      draft.tracks.find((t) => t.id === trackId)?.regions.push(region);
    });
    onSelect({ trackId, regionId: region.id });
  };

  // ── selection toolbar actions ─────────────────────────────────────────────
  const withSelected = (
    fn: (draft: DawProject, region: DawRegion, trackIndex: number) => void,
  ): void => {
    if (!selection) return;
    onUpdate((draft) => {
      const trackIndex = draft.tracks.findIndex((t) => t.id === selection.trackId);
      const region = draft.tracks[trackIndex]?.regions.find((r) => r.id === selection.regionId);
      if (region) fn(draft, region, trackIndex);
    });
  };

  const splitAtPlayhead = (): void =>
    withSelected((draft, region, trackIndex) => {
      const cut = transport.beat - region.startBeat;
      if (cut <= 0 || cut >= region.lengthBeats * region.loopCount) return;
      const localCut = cut % region.lengthBeats;
      const right = newRegion(region.startBeat + cut, region.lengthBeats * region.loopCount - cut);
      right.notes = region.notes
        .filter((n) => n.startBeat >= localCut)
        .map((n) => ({ ...n, startBeat: n.startBeat - localCut }));
      region.notes = region.notes.filter((n) => n.startBeat < localCut);
      region.lengthBeats = cut;
      region.loopCount = 1;
      draft.tracks[trackIndex]?.regions.push(right);
    });

  const duplicateRegion = (): void =>
    withSelected((draft, region, trackIndex) => {
      const copy = newRegion(
        region.startBeat + region.lengthBeats * region.loopCount,
        region.lengthBeats,
      );
      copy.loopCount = region.loopCount;
      copy.notes = region.notes.map((n) => ({ ...n }));
      draft.tracks[trackIndex]?.regions.push(copy);
    });

  const changeLoopCount = (delta: number): void =>
    withSelected((_draft, region) => {
      region.loopCount = Math.max(1, region.loopCount + delta);
    });

  const deleteRegion = (): void => {
    withSelected((draft, region, trackIndex) => {
      const track = draft.tracks[trackIndex];
      if (track) track.regions = track.regions.filter((r) => r.id !== region.id);
    });
    onSelect(null);
  };

  const selectedRegion =
    selection !== null
      ? (project.tracks
          .find((t) => t.id === selection.trackId)
          ?.regions.find((r) => r.id === selection.regionId) ?? null)
      : null;

  return (
    <div className="flex h-full flex-col">
      {/* zoom + selection toolbar */}
      <div className="flex items-center gap-2 border-b border-hairline bg-chrome-1 px-3 py-1">
        <div className="flex items-center gap-1">
          <ToolButton
            label="−"
            onClick={() => setPxPerBeat((z) => Math.max(12, z - 6))}
            aria="Zoom out"
          />
          <ToolButton
            label="+"
            onClick={() => setPxPerBeat((z) => Math.min(64, z + 6))}
            aria="Zoom in"
          />
        </div>
        {selectedRegion !== null ? (
          <div className="flex items-center gap-1">
            <ToolButton label="Split" onClick={splitAtPlayhead} aria="Split region at playhead" />
            <ToolButton label="Duplicate" onClick={duplicateRegion} aria="Duplicate region" />
            <ToolButton
              label="Loop −"
              onClick={() => changeLoopCount(-1)}
              aria="Loop one fewer pass"
            />
            <ToolButton
              label={`Loop ×${selectedRegion.loopCount} +`}
              onClick={() => changeLoopCount(1)}
              aria="Loop one more pass"
            />
            <ToolButton label="Delete" onClick={deleteRegion} aria="Delete region" danger />
          </div>
        ) : (
          <span className="numeric text-[10px] tracking-[0.14em] text-low uppercase">
            drag ruler = loop · double-tap lane = region
          </span>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto overscroll-contain">
        <div style={{ width: width + HEADER_W }} className="relative">
          {/* ── ruler ─────────────────────────────────────────────────────── */}
          <div className="sticky top-0 z-20 flex h-8 border-b border-hairline bg-chrome-1">
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-hairline bg-chrome-1"
              style={{ width: HEADER_W }}
            />
            <div
              className="relative h-full flex-1 cursor-pointer touch-none"
              onPointerDown={onRulerPointerDown}
              onPointerMove={onRulerPointerMove}
              onPointerUp={onRulerPointerUp}
            >
              {Array.from({ length: Math.ceil(totalBeats / beatsPerBar) }, (_, barIndex) => (
                <span
                  key={barIndex}
                  className="numeric absolute top-1.5 text-[10px] text-low select-none"
                  style={{ left: barIndex * beatsPerBar * pxPerBeat + 4 }}
                >
                  {barIndex + 1}
                </span>
              ))}
              {project.loop.enabled ? (
                <div
                  className="absolute top-0 h-full bg-accent-state/20"
                  style={{
                    left: project.loop.startBeat * pxPerBeat,
                    width: (project.loop.endBeat - project.loop.startBeat) * pxPerBeat,
                  }}
                />
              ) : null}
            </div>
          </div>

          {/* ── lanes ─────────────────────────────────────────────────────── */}
          {project.tracks.map((track) => {
            const audible = trackAudible(project, track);
            return (
              <div
                key={track.id}
                className="flex border-b border-hairline"
                style={{ height: LANE_H }}
              >
                {/* header */}
                <div
                  className="sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-1 border-r border-hairline bg-chrome-1 px-2"
                  style={{ width: HEADER_W }}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`min-w-0 truncate text-xs font-semibold ${audible ? 'text-hi' : 'text-low'}`}
                    >
                      {track.name}
                    </span>
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
                      aria={`Arm ${track.name} for recording (recording lands in Tier 2)`}
                      onClick={() =>
                        onUpdate((draft) => {
                          const t = draft.tracks.find((x) => x.id === track.id);
                          if (t) t.armed = !t.armed;
                        })
                      }
                    />
                    <span className="numeric ml-auto text-[9px] tracking-wide text-low uppercase">
                      {INSTRUMENT_LABELS[track.instrument]}
                    </span>
                  </div>
                </div>

                {/* lane */}
                <div
                  className={`relative flex-1 touch-pan-x ${audible ? '' : 'opacity-50'}`}
                  onPointerMove={onLanePointerMove}
                  onPointerUp={onLanePointerUp}
                  onDoubleClick={(e) => onLaneDoubleClick(track.id, e)}
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(90deg, var(--hairline) 0 1px, transparent 1px)',
                    backgroundSize: `${beatsPerBar * pxPerBeat}px 100%`,
                  }}
                >
                  {track.regions.map((region) => {
                    const isSelected =
                      selection?.trackId === track.id && selection.regionId === region.id;
                    const spanBeats = region.lengthBeats * region.loopCount;
                    return (
                      <div
                        key={region.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Region on ${track.name}`}
                        onPointerDown={(e) => onRegionPointerDown(e, track.id, region, false)}
                        className={`absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-[3px] border text-left ${
                          isSelected
                            ? 'border-accent-state bg-accent-state/25'
                            : 'border-accent-state/40 bg-accent-state/12 hover:bg-accent-state/20'
                        }`}
                        style={{ left: region.startBeat * pxPerBeat, width: spanBeats * pxPerBeat }}
                      >
                        <RegionSketch region={region} pxPerBeat={pxPerBeat} />
                        {region.loopCount > 1 ? (
                          <span className="numeric absolute top-0.5 right-4 text-[9px] text-accent-state">
                            ×{region.loopCount}
                          </span>
                        ) : null}
                        <div
                          role="presentation"
                          onPointerDown={(e) => onRegionPointerDown(e, track.id, region, true)}
                          className="absolute top-0 right-0 h-full w-3 cursor-ew-resize border-l border-accent-state/50"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* add track */}
          <div className="flex items-center gap-2 px-2 py-2" style={{ paddingLeft: 8 }}>
            {adding ? (
              (['oud', 'durbaan', 'bass', 'keys'] as const).map((instrument) => (
                <button
                  key={instrument}
                  type="button"
                  onClick={() => {
                    onAddTrack(instrument);
                    setAdding(false);
                  }}
                  className="rounded-[4px] border border-hairline bg-chrome-2 px-3 py-1.5 text-xs text-mid hover:border-accent-state hover:text-hi"
                >
                  {INSTRUMENT_LABELS[instrument]}
                </button>
              ))
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="rounded-[4px] border border-dashed border-hairline px-3 py-1.5 text-xs text-low hover:border-accent-state hover:text-accent-state"
              >
                + Add track
              </button>
            )}
          </div>

          {/* playhead */}
          <div
            ref={playheadRef}
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-accent-live"
            style={{ left: HEADER_W }}
          />
        </div>
      </div>
    </div>
  );
}

/** Tiny note sketch inside a region block. */
function RegionSketch({
  region,
  pxPerBeat,
}: {
  region: DawRegion;
  pxPerBeat: number;
}): React.JSX.Element {
  if (region.notes.length === 0) {
    return <span className="numeric absolute top-0.5 left-1 text-[9px] text-low">empty</span>;
  }
  let lo = 127;
  let hi = 0;
  for (const note of region.notes) {
    lo = Math.min(lo, note.midi);
    hi = Math.max(hi, note.midi);
  }
  const span = Math.max(1, hi - lo);
  return (
    <svg aria-hidden className="absolute inset-0 h-full w-full">
      {Array.from({ length: region.loopCount }, (_, pass) =>
        region.notes.map((note) => (
          <rect
            key={`${pass}:${note.id}`}
            x={(pass * region.lengthBeats + note.startBeat) * pxPerBeat}
            y={4 + (1 - (note.midi - lo) / span) * (LANE_H - 18)}
            width={Math.max(2, note.lengthBeats * pxPerBeat - 1)}
            height={3}
            className="fill-accent-state"
            opacity={pass === 0 ? 0.9 : 0.45}
          />
        )),
      )}
    </svg>
  );
}

function ToolButton({
  label,
  onClick,
  aria,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  aria: string;
  danger?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={aria}
      onClick={onClick}
      className={`numeric rounded-[4px] border px-2.5 py-1 text-[11px] tracking-wide uppercase transition-colors ${
        danger
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
      aria-pressed={active}
      onClick={onClick}
      className={`numeric h-5 w-5 rounded-[3px] border text-[9px] leading-none transition-colors ${
        active
          ? danger
            ? 'border-danger bg-danger/20 text-danger'
            : 'border-accent-state bg-accent-state/20 text-accent-state'
          : 'border-hairline text-low hover:text-hi'
      }`}
    >
      {label}
    </button>
  );
}
