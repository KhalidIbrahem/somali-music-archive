'use client';

/**
 * Mixer (Studio v2) — a channel strip per track and a master strip.
 *
 * Strip: name + kind badge, input/arm (audio tracks), 3-band EQ, compressor
 * (on/off, threshold, ratio), reverb send, pan, mute/solo, a dB-scaled fader
 * and a peak/RMS meter with peak hold and clip light. Master: limiter note,
 * record + input monitoring, fader and meter.
 *
 * Meters are drawn imperatively on canvases from ONE requestAnimationFrame
 * loop that polls engine.getLevels() — zero React re-renders per frame.
 * Every control edits the plain project through onUpdate; the engine applies
 * the change with smoothed ramps.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DawEngine, EngineLevels } from '@/lib/daw/engine';
import {
  COMP_RATIO_MAX,
  COMP_RATIO_MIN,
  COMP_THRESHOLD_MAX_DB,
  COMP_THRESHOLD_MIN_DB,
  EQ_MAX_DB,
  EQ_MIN_DB,
  faderPosToGain,
  formatDb,
  formatPan,
  gainToFaderPos,
  resolveFx,
} from '@/lib/daw/fx';
import {
  DEFAULT_FX,
  INSTRUMENT_LABELS,
  newAudioTrack,
  trackFx,
  trackKind,
  type DawProject,
  type DawTrack,
  type TrackFx,
} from '@/lib/daw/types';

type Update = (mutate: (draft: DawProject) => void) => void;

const METER_MIN_DB = -60;
const METER_MAX_DB = 6;
const METER_TICKS = [6, 0, -6, -12, -24, -48] as const;
const MASTER_ID = '__master__';

export function Mixer({
  project,
  engine,
  onUpdate,
}: {
  project: DawProject;
  engine: DawEngine;
  onUpdate: Update;
}): React.JSX.Element {
  const meters = useMeterLoop(engine);
  const [recording, setRecording] = useState(false);
  const [monitoring, setMonitoring] = useState(() => engine.isInputMonitoring());
  const [error, setError] = useState<string | null>(null);

  // Track the engine's recording state (a transport stop also ends a take).
  useEffect(() => {
    const sync = (): void => setRecording(engine.isRecording());
    const offTransport = engine.subscribe(sync);
    const offTakes = engine.onRecordingComplete(sync);
    sync();
    return () => {
      offTransport();
      offTakes();
    };
  }, [engine]);

  const armedTrack = project.tracks.find((t) => t.armed && trackKind(t) === 'audio') ?? null;

  const toggleRecord = (): void => {
    setError(null);
    if (engine.isRecording()) {
      engine.stopRecording().catch((e: unknown) => setError(messageOf(e)));
      return;
    }
    if (!armedTrack) {
      setError('Arm an audio track first.');
      return;
    }
    engine
      .startRecording(armedTrack.id)
      .then(() => setRecording(true))
      .catch((e: unknown) => setError(messageOf(e)));
  };

  const editTrack = useCallback(
    (trackId: string, mutate: (track: DawTrack) => void): void =>
      onUpdate((draft) => {
        const track = draft.tracks.find((t) => t.id === trackId);
        if (track) mutate(track);
      }),
    [onUpdate],
  );

  return (
    <div className="flex h-full items-stretch gap-2 overflow-auto p-3">
      {project.tracks.map((track) => (
        <ChannelStrip
          key={track.id}
          track={track}
          meterRef={meters.register(track.id)}
          onEdit={(mutate) => editTrack(track.id, mutate)}
        />
      ))}

      {/* ── master ─────────────────────────────────────────────────────── */}
      <div className="flex w-[168px] shrink-0 flex-col gap-1.5 rounded-[4px] border border-accent-state/40 bg-chrome-2 p-2">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[11px] font-semibold text-accent-state">Master</span>
          <Badge>Limit −1 dB</Badge>
        </div>
        <div className="flex min-h-0 flex-1 gap-2">
          <div className="flex w-[78px] shrink-0 flex-col gap-1.5">
            <button
              type="button"
              aria-pressed={recording}
              onClick={toggleRecord}
              title={armedTrack ? `Record into ${armedTrack.name}` : 'Arm an audio track first'}
              className={`numeric flex h-7 items-center justify-center gap-1.5 rounded-[3px] border text-[10px] tracking-wide uppercase ${
                recording
                  ? 'border-danger bg-danger/25 text-danger'
                  : 'border-hairline text-mid hover:border-danger hover:text-danger'
              }`}
            >
              <span
                aria-hidden
                className={`inline-block h-2 w-2 rounded-full bg-danger ${recording ? 'animate-pulse' : ''}`}
              />
              {recording ? 'Stop' : 'Rec'}
            </button>
            <span className="truncate text-[9px] text-low">
              {armedTrack ? `→ ${armedTrack.name}` : 'No track armed'}
            </span>
            <button
              type="button"
              aria-pressed={monitoring}
              onClick={() => {
                const next = !monitoring;
                engine.setInputMonitoring(next);
                setMonitoring(next);
              }}
              title="Hear the input while recording (use headphones)"
              className={toggleClass(monitoring)}
            >
              Monitor
            </button>
            {error ? (
              <span role="alert" className="text-[9px] leading-tight text-danger">
                {error}
              </span>
            ) : null}
            <span className="numeric mt-auto text-[9px] leading-tight text-low">
              Comp + reverb per track · limiter on master
            </span>
          </div>
          <FaderMeter
            label="Master"
            gain={project.masterGain}
            meterRef={meters.register(MASTER_ID)}
            onGain={(gain) =>
              onUpdate((draft) => {
                draft.masterGain = gain;
              })
            }
          />
        </div>
      </div>

      {/* ── add audio track ────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() =>
          onUpdate((draft) => {
            const n = draft.tracks.filter((t) => trackKind(t) === 'audio').length + 1;
            draft.tracks.push(newAudioTrack(`Audio ${n}`));
          })
        }
        className="numeric flex w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-[4px] border border-dashed border-hairline text-[10px] tracking-wide text-low uppercase transition-colors hover:border-accent-state hover:text-accent-state"
      >
        <span className="text-lg leading-none">+</span>
        Audio track
      </button>
    </div>
  );
}

function messageOf(e: unknown): string {
  if (e instanceof DOMException && e.name === 'NotAllowedError') {
    return 'Microphone permission was denied.';
  }
  return e instanceof Error ? e.message : 'Recording failed.';
}

function toggleClass(on: boolean): string {
  return `numeric h-6 rounded-[3px] border px-1.5 text-[10px] tracking-wide uppercase ${
    on ? 'border-accent-state bg-accent-state/20 text-accent-state' : 'border-hairline text-low'
  }`;
}

function Badge({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="numeric shrink-0 rounded-[2px] border border-hairline px-1 text-[8px] tracking-wider text-low uppercase">
      {children}
    </span>
  );
}

// ── channel strip ────────────────────────────────────────────────────────────

function ChannelStrip({
  track,
  meterRef,
  onEdit,
}: {
  track: DawTrack;
  meterRef: (canvas: HTMLCanvasElement | null) => void;
  onEdit: (mutate: (track: DawTrack) => void) => void;
}): React.JSX.Element {
  const isAudio = trackKind(track) === 'audio';
  const fx = resolveFx(trackFx(track));
  const editFx = (mutate: (fx: TrackFx) => void): void =>
    onEdit((t) => {
      const base = trackFx(t);
      const next: TrackFx = {
        eq: { ...base.eq },
        comp: { ...base.comp },
        reverbSend: base.reverbSend,
      };
      mutate(next);
      t.fx = next;
    });

  return (
    <div
      className={`flex w-[184px] shrink-0 flex-col gap-1.5 rounded-[4px] border border-hairline bg-chrome-2 p-2 ${
        track.muted ? 'opacity-70' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="min-w-0 truncate text-[11px] font-semibold text-hi" title={track.name}>
          {track.name}
        </span>
        <Badge>{isAudio ? 'Audio' : `MIDI · ${INSTRUMENT_LABELS[track.instrument]}`}</Badge>
      </div>

      <div className="flex min-h-0 flex-1 gap-2">
        <div className="flex w-[94px] shrink-0 flex-col gap-1">
          <SectionLabel>EQ</SectionLabel>
          <div className="flex justify-between">
            {(['low', 'mid', 'high'] as const).map((band) => (
              <Knob
                key={band}
                label={band === 'low' ? 'Lo' : band === 'mid' ? 'Mid' : 'Hi'}
                ariaLabel={`${track.name} EQ ${band}`}
                value={band === 'low' ? fx.lowDb : band === 'mid' ? fx.midDb : fx.highDb}
                min={EQ_MIN_DB}
                max={EQ_MAX_DB}
                step={0.5}
                defaultValue={DEFAULT_FX.eq[band]}
                bipolar
                format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
                onChange={(v) =>
                  editFx((f) => {
                    f.eq[band] = v;
                  })
                }
              />
            ))}
          </div>

          <div className="flex items-center justify-between">
            <SectionLabel>Comp</SectionLabel>
            <button
              type="button"
              aria-pressed={fx.compEnabled}
              aria-label={`${track.name} compressor`}
              onClick={() =>
                editFx((f) => {
                  f.comp.enabled = !f.comp.enabled;
                })
              }
              className={`numeric h-4 rounded-[2px] border px-1 text-[8px] uppercase ${
                fx.compEnabled
                  ? 'border-accent-state bg-accent-state/20 text-accent-state'
                  : 'border-hairline text-low'
              }`}
            >
              {fx.compEnabled ? 'On' : 'Off'}
            </button>
          </div>
          <div className={`flex justify-around ${fx.compEnabled ? '' : 'opacity-50'}`}>
            <Knob
              label="Thr"
              ariaLabel={`${track.name} compressor threshold`}
              value={fx.compThresholdDb}
              min={COMP_THRESHOLD_MIN_DB}
              max={COMP_THRESHOLD_MAX_DB}
              step={1}
              defaultValue={DEFAULT_FX.comp.thresholdDb}
              format={(v) => `${v.toFixed(0)} dB`}
              onChange={(v) =>
                editFx((f) => {
                  f.comp.thresholdDb = v;
                })
              }
            />
            <Knob
              label="Ratio"
              ariaLabel={`${track.name} compressor ratio`}
              value={fx.compRatio}
              min={COMP_RATIO_MIN}
              max={COMP_RATIO_MAX}
              step={0.5}
              defaultValue={DEFAULT_FX.comp.ratio}
              format={(v) => `${v.toFixed(1)}:1`}
              onChange={(v) =>
                editFx((f) => {
                  f.comp.ratio = v;
                })
              }
            />
          </div>

          <div className="flex justify-around">
            <Knob
              label="Rev"
              ariaLabel={`${track.name} reverb send`}
              value={fx.reverbSend}
              min={0}
              max={1}
              step={0.01}
              defaultValue={DEFAULT_FX.reverbSend}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) =>
                editFx((f) => {
                  f.reverbSend = v;
                })
              }
            />
            <Knob
              label="Pan"
              ariaLabel={`${track.name} pan`}
              value={track.pan}
              min={-1}
              max={1}
              step={0.02}
              defaultValue={0}
              bipolar
              format={formatPan}
              onChange={(v) =>
                onEdit((t) => {
                  t.pan = v;
                })
              }
            />
          </div>

          <div className="mt-auto flex gap-1">
            <button
              type="button"
              aria-pressed={track.muted}
              aria-label={`Mute ${track.name}`}
              onClick={() =>
                onEdit((t) => {
                  t.muted = !t.muted;
                })
              }
              className={`${toggleClass(track.muted)} w-7 px-0`}
            >
              M
            </button>
            <button
              type="button"
              aria-pressed={track.solo}
              aria-label={`Solo ${track.name}`}
              onClick={() =>
                onEdit((t) => {
                  t.solo = !t.solo;
                })
              }
              className={`${toggleClass(track.solo)} w-7 px-0`}
            >
              S
            </button>
            {isAudio ? (
              <button
                type="button"
                aria-pressed={track.armed}
                aria-label={`Arm ${track.name} for recording (input: microphone)`}
                title="Record arm · input: default microphone"
                onClick={() =>
                  onEdit((t) => {
                    t.armed = !t.armed;
                  })
                }
                className={`numeric h-6 w-7 rounded-[3px] border text-[10px] ${
                  track.armed
                    ? 'border-danger bg-danger/25 text-danger'
                    : 'border-hairline text-low hover:text-danger'
                }`}
              >
                ●
              </button>
            ) : (
              <span className="numeric flex h-6 items-center px-1 text-[8px] text-low uppercase">
                In: notes
              </span>
            )}
          </div>
        </div>

        <FaderMeter
          label={track.name}
          gain={track.gain}
          meterRef={meterRef}
          onGain={(gain) =>
            onEdit((t) => {
              t.gain = gain;
            })
          }
        />
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="numeric text-[8px] tracking-[0.16em] text-low uppercase">{children}</span>
  );
}

// ── fader + meter ────────────────────────────────────────────────────────────

function FaderMeter({
  label,
  gain,
  meterRef,
  onGain,
}: {
  label: string;
  gain: number;
  meterRef: (canvas: HTMLCanvasElement | null) => void;
  onGain: (gain: number) => void;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
      <span className="numeric text-[10px] text-mid" aria-hidden>
        {formatDb(gain)}
      </span>
      <div className="flex min-h-[96px] flex-1 items-stretch gap-1.5">
        <input
          type="range"
          min={0}
          max={1}
          step={0.002}
          value={gainToFaderPos(gain)}
          aria-label={`${label} volume`}
          aria-valuetext={`${formatDb(gain)} dB`}
          onChange={(e) => {
            const next = faderPosToGain(Number(e.target.value));
            onGain(Math.abs(next - 1) < 0.015 ? 1 : next);
          }}
          onDoubleClick={() => onGain(1)}
          className="w-4 accent-(--accent-state) [direction:rtl] [writing-mode:vertical-lr]"
        />
        <canvas
          ref={meterRef}
          width={26}
          height={120}
          className="h-full w-[26px] rounded-[2px]"
          aria-hidden
        />
      </div>
      <span data-peak className="numeric text-[9px] text-low" aria-hidden>
        -∞
      </span>
    </div>
  );
}

// ── the single meter loop ────────────────────────────────────────────────────

interface MeterState {
  canvas: HTMLCanvasElement;
  label: Element | null;
  holdDb: number;
  holdUntil: number;
  clipUntil: number;
  lastText: string;
}

interface MeterColors {
  bg: string;
  tick: string;
  rms: string;
  peak: string;
  hot: string;
}

function useMeterLoop(engine: DawEngine): {
  register: (id: string) => (canvas: HTMLCanvasElement | null) => void;
} {
  const states = useRef(new Map<string, MeterState>());
  const callbacks = useRef(new Map<string, (canvas: HTMLCanvasElement | null) => void>());

  const register = useCallback((id: string) => {
    let cb = callbacks.current.get(id);
    if (!cb) {
      cb = (canvas: HTMLCanvasElement | null): void => {
        if (canvas) {
          states.current.set(id, {
            canvas,
            label: canvas.parentElement?.parentElement?.querySelector('[data-peak]') ?? null,
            holdDb: -Infinity,
            holdUntil: 0,
            clipUntil: 0,
            lastText: '',
          });
        } else {
          states.current.delete(id);
        }
      };
      callbacks.current.set(id, cb);
    }
    return cb;
  }, []);

  useEffect(() => {
    let raf = 0;
    let colors: MeterColors | null = null;
    const draw = (now: number): void => {
      const levels: EngineLevels = engine.getLevels();
      for (const [id, state] of states.current) {
        const g = state.canvas.getContext('2d');
        if (!g) continue;
        colors ??= readColors(state.canvas);
        const reading = id === MASTER_ID ? levels.master : levels.tracks[id];
        drawMeter(g, state, reading?.peakDb ?? -Infinity, reading?.rmsDb ?? -Infinity, now, colors);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  return { register };
}

function readColors(el: Element): MeterColors {
  const styles = getComputedStyle(el);
  const v = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--chrome-1', '#14131d'),
    tick: v('--hairline', '#2a2838'),
    rms: v('--accent-state', '#C89B5F'),
    peak: v('--text-mid', '#a19d8f'),
    hot: v('--danger', '#e5484d'),
  };
}

function meterY(db: number, top: number, height: number): number {
  const clamped = Math.min(METER_MAX_DB, Math.max(METER_MIN_DB, db));
  return top + height * (1 - (clamped - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB));
}

function drawMeter(
  g: CanvasRenderingContext2D,
  state: MeterState,
  peakDb: number,
  rmsDb: number,
  now: number,
  colors: MeterColors,
): void {
  if (peakDb >= state.holdDb || now > state.holdUntil) {
    state.holdDb = peakDb;
    state.holdUntil = now + 1200;
  }
  if (peakDb > -0.1) state.clipUntil = now + 1500;

  const { width, height } = state.canvas;
  const clipH = 4;
  const top = clipH + 1;
  const meterH = height - top;
  const y = (db: number): number => meterY(db, top, meterH);
  const barW = Math.floor((width - 8) / 2);
  g.fillStyle = colors.bg;
  g.fillRect(0, 0, width, height);
  g.fillStyle = now < state.clipUntil ? colors.hot : colors.tick;
  g.fillRect(0, 0, width, clipH);
  g.fillStyle = colors.tick;
  for (const tick of METER_TICKS) g.fillRect(width - 6, Math.round(y(tick)), 6, 1);

  // Peak (left) and RMS (right) bars; the part above 0 dBFS is red.
  const zero = y(0);
  const bar = (x: number, db: number, color: string): void => {
    if (!(db > METER_MIN_DB)) return;
    const barTop = y(db);
    g.fillStyle = color;
    g.fillRect(x, Math.max(barTop, zero), barW, height - Math.max(barTop, zero));
    if (barTop < zero) {
      g.fillStyle = colors.hot;
      g.fillRect(x, barTop, barW, zero - barTop);
    }
  };
  bar(0, peakDb, colors.peak);
  bar(barW + 1, rmsDb, colors.rms);
  if (state.holdDb > METER_MIN_DB) {
    g.fillStyle = state.holdDb > 0 ? colors.hot : colors.rms;
    g.fillRect(0, Math.round(y(state.holdDb)), barW * 2 + 1, 1);
  }
  const text = state.holdDb > METER_MIN_DB ? state.holdDb.toFixed(1) : '-∞';
  if (text !== state.lastText) {
    if (state.label) state.label.textContent = text;
    state.lastText = text;
  }
}

// ── knob ─────────────────────────────────────────────────────────────────────

const KNOB_R = 9;
const KNOB_C = 12;
const KNOB_START = -135;

function knobPoint(deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [KNOB_C + KNOB_R * Math.cos(rad), KNOB_C + KNOB_R * Math.sin(rad)];
}

function knobArc(from: number, to: number): string {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const [x1, y1] = knobPoint(a);
  const [x2, y2] = knobPoint(b);
  return `M ${x1} ${y1} A ${KNOB_R} ${KNOB_R} 0 ${b - a > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

/** A 270° rotary control: vertical drag (Shift = fine), arrows/Page/Home/End, double-click resets. */
function Knob({
  label,
  ariaLabel,
  value,
  min,
  max,
  step,
  defaultValue,
  bipolar = false,
  format,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  bipolar?: boolean;
  format: (value: number) => string;
  onChange: (value: number) => void;
}): React.JSX.Element {
  const drag = useRef<{ y: number; value: number } | null>(null);
  const commit = (v: number): void => {
    const clamped = Math.min(max, Math.max(min, v));
    const q = Number((Math.round(clamped / step) * step).toFixed(4));
    if (q !== value) onChange(q);
  };

  const t = (Math.min(max, Math.max(min, value)) - min) / (max - min);
  const angle = KNOB_START + 270 * t;
  const zeroAngle = KNOB_START + 270 * (bipolar ? (0 - min) / (max - min) : 0);
  const [px, py] = knobPoint(angle);

  return (
    <div className="flex w-[30px] flex-col items-center">
      <div
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        title={`${label}: ${format(value)} (double-click to reset)`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, value };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const pixels = e.shiftKey ? 600 : 150;
          commit(d.value + ((d.y - e.clientY) / pixels) * (max - min));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onDoubleClick={() => commit(defaultValue)}
        onKeyDown={(e) => {
          const big = (max - min) / 10;
          let next: number | null = null;
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = value + step;
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = value - step;
          else if (e.key === 'PageUp') next = value + big;
          else if (e.key === 'PageDown') next = value - big;
          else if (e.key === 'Home') next = min;
          else if (e.key === 'End') next = max;
          if (next === null) return;
          e.preventDefault();
          commit(next);
        }}
        className="cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-1 focus-visible:ring-accent-state"
      >
        <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden>
          <path
            d={knobArc(KNOB_START, KNOB_START + 270)}
            fill="none"
            stroke="var(--hairline)"
            strokeWidth={2.5}
          />
          {Math.abs(angle - zeroAngle) > 0.5 ? (
            <path
              d={knobArc(zeroAngle, angle)}
              fill="none"
              stroke="var(--accent-state)"
              strokeWidth={2.5}
            />
          ) : null}
          <circle cx={KNOB_C} cy={KNOB_C} r={5.5} fill="var(--chrome-1)" />
          <line
            x1={KNOB_C}
            y1={KNOB_C}
            x2={px}
            y2={py}
            stroke="var(--text-hi)"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        </svg>
      </div>
      <span className="numeric text-[8px] leading-none text-low">{label}</span>
    </div>
  );
}
