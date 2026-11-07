'use client';

/**
 * PlaySurface (Studio v3) — the studio's on-screen playable instrument, in the
 * spirit of GarageBand's touch instruments and Logic for iPad's Play Surfaces.
 *
 * Keyboard view (oud / bass / keys): two octaves of piano keys, three on wide
 * panels, one and a half on phones; velocity from where a key is struck (top
 * soft, bottom loud); scale-lock tinting with the root marked; a "Scale" layout
 * of equal bars holding only the in-scale pitches, numbered by degree. Pads
 * view (durbaan): dum / tak / slap, ghost to accent by vertical position.
 *
 * Multi-touch: every pointer (finger, pen, mouse) holds its own key and slides
 * across the keyboard. The surface never touches audio — it reports onNoteOn /
 * onNoteOff with balanced calls and the parent routes them to the engine (and
 * into the take while recording).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isInScale, midiName } from '@/lib/daw/scales';
import {
  KEY_VELOCITY_MIN,
  PAD_VELOCITY_MIN,
  SURFACE_OCTAVE_MAX,
  SURFACE_OCTAVE_MIN,
  clampOctave,
  keyboardLayout,
  keyboardRangeLabel,
  octavesForWidth,
  padForMidi,
  scaleOnlyLayout,
  velocityFromY,
  whiteKeyCount,
} from '@/lib/daw/playSurface';
import {
  DURBAAN_LANES,
  INSTRUMENT_LABELS,
  type DawProject,
  type InstrumentId,
} from '@/lib/daw/types';

export interface PlaySurfaceProps {
  instrument: InstrumentId;
  scaleLock: DawProject['scaleLock']; // { enabled: boolean; root: number; mode: PentatonicMode }
  heldNotes: readonly number[]; // MIDI numbers sounding now (from any input)
  octave: number; // octave of the leftmost C (scientific pitch: 4 → C4 = MIDI 60)
  onOctaveChange: (octave: number) => void;
  onNoteOn: (midi: number, velocity: number) => void; // call exactly once per press
  onNoteOff: (midi: number) => void; // call exactly once per release
  compact?: boolean; // phone layout: bigger touch targets, fewer labels
}

export function PlaySurface({
  instrument,
  scaleLock,
  heldNotes,
  octave,
  onOctaveChange,
  onNoteOn,
  onNoteOff,
  compact = false,
}: PlaySurfaceProps): React.JSX.Element {
  const isPads = instrument === 'durbaan';
  const rootRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [scaleOnly, setScaleOnly] = useState(false);

  // The octave count follows the panel width; the observer reports the initial
  // size on observe(), so no synchronous measurement is needed.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { pressed, handlers, releaseAll } = usePointerNotes(surfaceRef, onNoteOn, onNoteOff, {
    glissando: !isPads,
    minVelocity: isPads ? PAD_VELOCITY_MIN : KEY_VELOCITY_MIN,
  });

  // Switching instrument swaps the view: let go of whatever the old one held.
  useEffect(() => () => releaseAll(), [instrument, releaseAll]);

  const safeOctave = clampOctave(octave);
  const octaves = octavesForWidth(width);
  const keys = useMemo(() => keyboardLayout(safeOctave, octaves), [safeOctave, octaves]);
  const bars = useMemo(
    () => scaleOnlyLayout(safeOctave, octaves, scaleLock.root, scaleLock.mode),
    [safeOctave, octaves, scaleLock.root, scaleLock.mode],
  );
  const whites = whiteKeyCount(keys);
  const heldSet = useMemo(() => new Set(heldNotes), [heldNotes]);
  const scaleOnlyActive = scaleOnly && scaleLock.enabled;
  const whiteKeyPx = whites > 0 && width > 0 ? width / whites : 0;
  const showScaleLabels = !compact && whiteKeyPx >= 30;
  const showBlackLabels = !compact && whiteKeyPx >= 56;
  const rootPc = ((scaleLock.root % 12) + 12) % 12;
  const label = INSTRUMENT_LABELS[instrument];
  const rangeLabel = keyboardRangeLabel(keys);
  const isHeld = (midi: number): boolean => pressed.has(midi) || heldSet.has(midi);

  const readout = useMemo(() => {
    const all = [...new Set([...heldNotes, ...pressed])].sort((a, b) => a - b);
    return all
      .map((midi) => (isPads ? (padForMidi(midi) ?? midiName(midi)) : midiName(midi)))
      .join(' ');
  }, [heldNotes, pressed, isPads]);

  const surfaceClass = `relative w-full flex-1 touch-none select-none overflow-hidden bg-chrome-2 ${
    compact ? 'min-h-[168px]' : 'min-h-[140px]'
  }`;

  return (
    <div
      ref={rootRef}
      className="flex h-full w-full flex-col bg-chrome-2"
      data-testid="play-surface"
    >
      {/* header strip */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-hairline bg-chrome-1 px-2 py-1">
        <span className="font-display text-sm text-hi">{label}</span>
        <span className="numeric text-[9px] tracking-[0.14em] text-low uppercase">
          {isPads ? 'pads' : 'keyboard'}
        </span>

        {!isPads && (
          <>
            <Chip
              label="Scale"
              active={scaleOnlyActive}
              disabled={!scaleLock.enabled}
              title={
                scaleLock.enabled
                  ? 'Scale-only keys — only the in-scale pitches, numbered by degree'
                  : 'Turn on Scale lock in the transport to use the scale-only keyboard'
              }
              onClick={() => setScaleOnly((on) => !on)}
            />
            <div className="flex items-center gap-0.5" role="group" aria-label="Octave">
              <OctaveButton
                label="Octave down"
                disabled={safeOctave <= SURFACE_OCTAVE_MIN}
                onClick={() => onOctaveChange(clampOctave(safeOctave - 1))}
              >
                −
              </OctaveButton>
              <span
                className="numeric min-w-[5.5rem] text-center text-[11px] text-hi"
                title="Keys on screen"
              >
                {rangeLabel}
              </span>
              <OctaveButton
                label="Octave up"
                disabled={safeOctave >= SURFACE_OCTAVE_MAX}
                onClick={() => onOctaveChange(clampOctave(safeOctave + 1))}
              >
                +
              </OctaveButton>
            </div>
          </>
        )}

        <div className="ml-auto flex min-w-0 items-baseline gap-1.5" title="Held notes">
          {!compact && (
            <span className="numeric text-[9px] tracking-[0.14em] text-low uppercase">held</span>
          )}
          <span className="numeric min-w-8 truncate text-[11px] text-hi">{readout || '—'}</span>
        </div>
      </div>

      {isPads ? (
        <div
          ref={surfaceRef}
          role="group"
          aria-label={`${label} pads`}
          className={`${surfaceClass} grid grid-cols-3 gap-2 p-2`}
          style={{ WebkitTouchCallout: 'none' }}
          {...handlers}
        >
          {DURBAAN_LANES.map((lane) => {
            const held = isHeld(lane.midi);
            return (
              <button
                key={lane.midi}
                type="button"
                data-midi={lane.midi}
                tabIndex={-1}
                aria-label={`${lane.label} pad`}
                aria-pressed={held}
                className={`relative flex flex-col items-center justify-center overflow-hidden rounded-[4px] border transition-all duration-75 motion-reduce:transition-none ${
                  compact ? 'min-h-[96px]' : 'min-h-[72px]'
                } ${
                  held
                    ? 'scale-[0.97] border-accent-live bg-accent-live/50 brightness-110 motion-reduce:scale-100'
                    : 'border-hairline bg-chrome-1'
                }`}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-accent-state/10"
                />
                <span className="relative font-display text-lg text-hi">{lane.label}</span>
                {!compact && (
                  <span className="numeric pointer-events-none absolute inset-x-0 bottom-1.5 text-center text-[9px] tracking-[0.14em] text-low uppercase">
                    ghost · normal · accent
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : scaleOnlyActive ? (
        <div
          ref={surfaceRef}
          role="group"
          aria-label={`${label} scale keys, ${rangeLabel}`}
          className={`${surfaceClass} flex gap-px p-px`}
          style={{ WebkitTouchCallout: 'none' }}
          {...handlers}
        >
          {bars.map((bar) => {
            const held = isHeld(bar.midi);
            return (
              <button
                key={bar.midi}
                type="button"
                data-midi={bar.midi}
                tabIndex={-1}
                aria-label={`${midiName(bar.midi)}, degree ${bar.degree}`}
                aria-pressed={held}
                className={`relative min-w-0 flex-1 overflow-hidden rounded-[4px] border border-hairline ${
                  bar.isRoot ? 'bg-accent-state/45' : 'bg-accent-state/20'
                }`}
              >
                {held && <HeldOverlay />}
                <span className="numeric pointer-events-none absolute inset-x-0 top-1.5 text-center text-[11px] text-hi">
                  {bar.degree}
                </span>
                {bar.isRoot && (
                  <RootDot className={showScaleLabels ? 'bottom-[18px]' : 'bottom-2'} />
                )}
                {showScaleLabels && (
                  <span className="numeric pointer-events-none absolute inset-x-0 bottom-1 text-center text-[9px] tracking-[0.08em] text-mid uppercase">
                    {midiName(bar.midi)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div
          ref={surfaceRef}
          role="group"
          aria-label={`${label} keyboard, ${rangeLabel}`}
          className={surfaceClass}
          style={{ WebkitTouchCallout: 'none' }}
          {...handlers}
        >
          {keys.map((key) => {
            const held = isHeld(key.midi);
            const inScale =
              scaleLock.enabled && isInScale(key.midi, scaleLock.root, scaleLock.mode);
            const isRoot = inScale && key.midi % 12 === rootPc;
            const showLabel =
              key.midi % 12 === 0 || (inScale && (key.black ? showBlackLabels : showScaleLabels));
            return (
              <button
                key={key.midi}
                type="button"
                data-midi={key.midi}
                tabIndex={-1}
                aria-label={midiName(key.midi)}
                aria-pressed={held}
                className={`absolute top-0 overflow-hidden rounded-b-[4px] border ${
                  key.black
                    ? 'z-10 h-[62%] border-(--confidence-ink) bg-(--confidence-ink)'
                    : 'h-full border-paper-edge bg-paper'
                }`}
                style={{
                  left: `${(key.x / whites) * 100}%`,
                  width: `${(key.w / whites) * 100}%`,
                }}
              >
                {inScale && (
                  <span
                    aria-hidden
                    className={`pointer-events-none absolute inset-0 ${
                      isRoot ? 'bg-accent-state/45' : 'bg-accent-state/20'
                    }`}
                  />
                )}
                {held && <HeldOverlay />}
                {isRoot && <RootDot className={key.black ? 'bottom-1.5' : 'bottom-[18px]'} />}
                {showLabel && (
                  <span
                    className={`numeric pointer-events-none absolute inset-x-0 text-center text-[9px] tracking-[0.08em] uppercase ${
                      key.black ? 'bottom-4 text-paper/80' : 'bottom-1 text-(--confidence-ink)/70'
                    }`}
                  >
                    {midiName(key.midi)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface SurfaceHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
  onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
}

interface KeyHit {
  el: HTMLElement;
  midi: number;
}

/**
 * Pointer → note bookkeeping shared by the keyboard and the pads. Every pointer
 * holds one key; a key sounds while at least one pointer holds it, so on/off
 * calls stay balanced however fingers overlap, slide or leave the window.
 * `minVelocity` is the velocity at a key's top edge; `glissando` lets a moving
 * pointer slide from key to key (keys yes, pads no).
 */
function usePointerNotes(
  surfaceRef: React.RefObject<HTMLDivElement | null>,
  onNoteOn: PlaySurfaceProps['onNoteOn'],
  onNoteOff: PlaySurfaceProps['onNoteOff'],
  options: { glissando: boolean; minVelocity: number },
): { pressed: ReadonlySet<number>; handlers: SurfaceHandlers; releaseAll: () => void } {
  const callbacks = useRef({ onNoteOn, onNoteOff });
  useEffect(() => {
    callbacks.current = { onNoteOn, onNoteOff };
  });
  /** pointerId → the MIDI note it holds. */
  const pointers = useRef(new Map<number, number>());
  /** MIDI note → how many pointers hold it. */
  const counts = useRef(new Map<number, number>());
  const [pressed, setPressed] = useState<ReadonlySet<number>>(() => new Set<number>());
  const { glissando, minVelocity } = options;

  const releasePointer = useCallback((pointerId: number): void => {
    const midi = pointers.current.get(pointerId);
    if (midi === undefined) return;
    pointers.current.delete(pointerId);
    const remaining = (counts.current.get(midi) ?? 1) - 1;
    if (remaining > 0) {
      counts.current.set(midi, remaining);
    } else {
      counts.current.delete(midi);
      callbacks.current.onNoteOff(midi);
    }
    setPressed(new Set(counts.current.keys()));
  }, []);

  const pressPointer = useCallback(
    (pointerId: number, midi: number, velocity: number): void => {
      const current = pointers.current.get(pointerId);
      if (current === midi) return;
      if (current !== undefined) releasePointer(pointerId);
      pointers.current.set(pointerId, midi);
      const holding = (counts.current.get(midi) ?? 0) + 1;
      counts.current.set(midi, holding);
      if (holding === 1) callbacks.current.onNoteOn(midi, velocity);
      setPressed(new Set(counts.current.keys()));
    },
    [releasePointer],
  );

  const releaseAll = useCallback((): void => {
    for (const pointerId of [...pointers.current.keys()]) releasePointer(pointerId);
  }, [releasePointer]);

  // While anything is down, a release anywhere — outside the surface, off the
  // window, a cancelled touch, focus or visibility lost — still ends the note.
  const anyDown = pressed.size > 0;
  useEffect(() => {
    if (!anyDown) return;
    const up = (e: PointerEvent): void => releasePointer(e.pointerId);
    const hidden = (): void => {
      if (document.visibilityState === 'hidden') releaseAll();
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [anyDown, releasePointer, releaseAll]);

  // Unmount releases everything that is still held.
  useEffect(() => releaseAll, [releaseAll]);

  const keyHit = useCallback(
    (target: Element | null): KeyHit | null => {
      const el = target?.closest<HTMLElement>('[data-midi]') ?? null;
      if (!el || !surfaceRef.current?.contains(el)) return null;
      const midi = Number(el.getAttribute('data-midi'));
      return Number.isInteger(midi) ? { el, midi } : null;
    },
    [surfaceRef],
  );

  const pressAt = useCallback(
    (pointerId: number, hit: KeyHit, clientY: number): void => {
      const rect = hit.el.getBoundingClientRect();
      pressPointer(
        pointerId,
        hit.midi,
        velocityFromY(clientY - rect.top, rect.height, minVelocity),
      );
    },
    [pressPointer, minVelocity],
  );

  const handlers = useMemo<SurfaceHandlers>(
    () => ({
      onPointerDown: (e) => {
        if (e.button !== 0) return;
        const hit = keyHit(e.target instanceof Element ? e.target : null);
        if (!hit) return;
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // The pointer ended before capture — the window listeners cover it.
        }
        pressAt(e.pointerId, hit, e.clientY);
      },
      onPointerMove: (e) => {
        if (!glissando) return;
        const held = pointers.current.get(e.pointerId);
        if (held === undefined) return;
        const hit = keyHit(document.elementFromPoint(e.clientX, e.clientY));
        if (!hit || hit.midi === held) return;
        pressAt(e.pointerId, hit, e.clientY);
      },
      onPointerUp: (e) => releasePointer(e.pointerId),
      onPointerCancel: (e) => releasePointer(e.pointerId),
      onContextMenu: (e) => e.preventDefault(),
    }),
    [glissando, keyHit, pressAt, releasePointer],
  );

  return { pressed, handlers, releaseAll };
}

function HeldOverlay(): React.JSX.Element {
  return <span aria-hidden className="pointer-events-none absolute inset-0 bg-accent-live/50" />;
}

function RootDot({ className }: { className: string }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-accent-state ${className}`}
    />
  );
}

function Chip({
  label,
  title,
  active,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
      title={title}
      className={`numeric h-8 rounded-[4px] border px-1.5 text-[10px] tracking-[0.08em] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-accent-state bg-accent-state/15 text-accent-state'
          : 'border-hairline text-low hover:text-hi disabled:hover:text-low'
      }`}
    >
      {label}
    </button>
  );
}

function OctaveButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="numeric flex h-8 w-8 items-center justify-center rounded-[4px] border border-hairline text-sm text-mid transition-colors hover:border-accent-state hover:text-hi disabled:opacity-30 disabled:hover:border-hairline disabled:hover:text-mid"
    >
      {children}
    </button>
  );
}
