'use client';

/**
 * RecordPanel (Studio v3) — the bottom panel's "Record" tab: a guided,
 * GarageBand-like recording flow for musicians who are not DAW users. Five
 * cards in the order of the flow: check the microphone (live peak/RMS meter),
 * pick the track the take lands on, count-in and click, the record button,
 * and the takes made in this browser with Pitch / Rename / Delete.
 *
 * The meter is drawn imperatively on a canvas from ONE requestAnimationFrame
 * loop that polls engine.getInputLevel() (null = microphone closed) — no
 * React re-render per frame. Arming, count-in, click, renames and deletes
 * edit the plain project through onUpdate; the parent's history makes every
 * one of them undoable. Recording itself is the parent's (onToggleRecord):
 * this panel only shows its state.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DawEngine, EngineSnapshot } from '@/lib/daw/engine';
import {
  RECORD_CLIP_DB,
  RECORD_METER_MIN_DB,
  RECORD_METER_TICKS,
  RECORD_PEAK_HOLD_MS,
  armOnly,
  dbToMeterPos,
  elapsedLabel,
  recordBlockedReason,
  recordableTakes,
  type RecordableTake,
} from '@/lib/daw/recordFlow';
import { audioRegionsOf, trackKind, type DawProject } from '@/lib/daw/types';

/** Mirror of DawApp's RecordingInfo (declared here so this file never imports DawApp). */
export interface RecordingInfo {
  trackIds: string[];
  startBeat: number;
}

export interface RecordPanelProps {
  project: DawProject;
  engine: DawEngine;
  transport: EngineSnapshot;
  recording: RecordingInfo | null;
  selectedTrackId: string | null;
  onUpdate: (mutate: (draft: DawProject) => void, coalesceKey?: string) => void;
  onToggleRecord: () => void;
  onAddAudioTrack: () => void;
  onSelectTrack: (trackId: string) => void;
  onOpenPitch: (trackId: string, regionId: string) => void;
  onNotice: (message: string) => void;
}

const EPS = 1e-6;
/** How long after "New audio track" the track that appears is armed automatically. */
const ARM_NEW_TRACK_WINDOW_MS = 2000;
const WIDE_QUERY = '(min-width: 1024px)';
const COUNT_IN_OPTIONS = [0, 1, 2] as const;

export function RecordPanel({
  project,
  engine,
  transport,
  recording,
  selectedTrackId,
  onUpdate,
  onToggleRecord,
  onAddAudioTrack,
  onSelectTrack,
  onOpenPitch,
  onNotice,
}: RecordPanelProps): React.JSX.Element {
  const isRecording = recording !== null;
  const beatsPerBar = project.timeSignature.beatsPerBar;
  const secPerBeat = 60 / project.bpm;
  const audioTracks = project.tracks.filter((t) => trackKind(t) === 'audio');
  const armedTracks = project.tracks.filter((t) => t.armed);
  const selected = project.tracks.find((t) => t.id === selectedTrackId) ?? null;
  const selectedMidi = selected && trackKind(selected) === 'midi' ? selected : null;
  const audioTake =
    recording !== null && recording.trackIds.some((id) => audioTracks.some((t) => t.id === id));
  const blocked = recordBlockedReason(project, selectedTrackId);
  const takes = recordableTakes(project);

  const arm = useCallback(
    (trackId: string): void => {
      onUpdate((draft) => armOnly(draft, trackId), 'arm');
      onSelectTrack(trackId);
    },
    [onUpdate, onSelectTrack],
  );

  // "New audio track" arms the track that appears, so it is ready to record.
  const armNewUntilRef = useRef(0);
  const seenIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const seen = seenIdsRef.current;
    seenIdsRef.current = new Set(project.tracks.map((t) => t.id));
    if (!seen || Date.now() > armNewUntilRef.current) return;
    const fresh = project.tracks.find((t) => trackKind(t) === 'audio' && !seen.has(t.id));
    if (!fresh) return;
    armNewUntilRef.current = 0;
    arm(fresh.id);
  }, [project.tracks, arm]);

  const addAudioTrack = (): void => {
    armNewUntilRef.current = Date.now() + ARM_NEW_TRACK_WINDOW_MS;
    onAddAudioTrack();
  };

  const renameTake = (take: RecordableTake, name: string): void => {
    const trimmed = name.trim().slice(0, 80);
    if (trimmed === '' || trimmed === take.region.name) return;
    onUpdate((draft) => {
      const track = draft.tracks.find((t) => t.id === take.trackId);
      const region = track ? audioRegionsOf(track).find((r) => r.id === take.region.id) : null;
      if (region) region.name = trimmed;
    });
  };

  const deleteTake = (take: RecordableTake): void => {
    onUpdate((draft) => {
      const track = draft.tracks.find((t) => t.id === take.trackId);
      if (!track) return;
      track.audioRegions = audioRegionsOf(track).filter((r) => r.id !== take.region.id);
    });
    onNotice(`Deleted ${take.region.name} — undo with ⌘Z`);
  };

  const startBar = Math.floor(Math.max(0, transport.beat) / beatsPerBar + EPS) + 1;

  return (
    <div className="h-full overflow-auto">
      <div className="flex min-h-full flex-col gap-2 p-3 lg:flex-row lg:flex-wrap lg:items-stretch">
        <InputCard engine={engine} audioTake={audioTake} className="lg:w-[250px] lg:shrink-0" />

        {/* ── 2 · target ────────────────────────────────────────────────── */}
        <Card
          step={2}
          title="Target"
          hint="where the take lands"
          className="lg:min-w-[220px] lg:flex-1"
        >
          {audioTracks.length === 0 ? (
            <p className="text-xs leading-snug text-mid">
              This project has no audio track yet — add one to record the microphone into.
            </p>
          ) : (
            <div role="radiogroup" aria-label="Record into track" className="flex flex-col gap-1">
              {audioTracks.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  role="radio"
                  aria-checked={track.armed}
                  onClick={() => arm(track.id)}
                  title={track.armed ? `${track.name} is armed` : `Arm ${track.name} for recording`}
                  className={`flex h-8 items-center gap-2 rounded-[4px] border px-2 text-left text-xs transition-colors ${
                    track.armed
                      ? 'border-danger/60 bg-danger/10 text-hi'
                      : 'border-hairline text-mid hover:border-accent-state hover:text-hi'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`text-[11px] leading-none ${track.armed ? 'text-danger' : 'text-low'}`}
                  >
                    ●
                  </span>
                  <span className="min-w-0 flex-1 truncate">{track.name}</span>
                  {track.armed ? (
                    <span className="numeric text-[9px] tracking-[0.14em] text-danger uppercase">
                      armed
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
          <SmallButton onClick={addAudioTrack} title="Add an audio track and arm it">
            + New audio track
          </SmallButton>
          <p className="numeric text-[10px] text-low">
            {armedTracks.length === 0
              ? 'Nothing armed'
              : `Armed: ${armedTracks
                  .map((t) => `${t.name}${trackKind(t) === 'midi' ? ' (instrument)' : ''}`)
                  .join(', ')}`}
          </p>
          <div className="mt-auto flex flex-col gap-1.5 border-t border-hairline pt-2">
            <p className="text-[11px] leading-snug text-low">
              To record the on-screen instrument or a MIDI keyboard, arm an instrument track
              instead.
            </p>
            <SmallButton
              onClick={() => {
                if (selectedMidi) arm(selectedMidi.id);
              }}
              disabled={selectedMidi === null}
              title={
                selectedMidi
                  ? `Arm ${selectedMidi.name} (instrument track)`
                  : 'Select an instrument track in the arrangement first'
              }
            >
              {selectedMidi ? `Arm ${selectedMidi.name}` : 'Arm selected instrument track'}
            </SmallButton>
          </div>
        </Card>

        {/* ── 3 · settings ──────────────────────────────────────────────── */}
        <Card step={3} title="Count-in & click" className="lg:min-w-[220px] lg:flex-1">
          <Row label="Count-in">
            {COUNT_IN_OPTIONS.map((bars) => (
              <Chip
                key={bars}
                active={project.metronome.countInBars === bars}
                title={
                  bars === 0
                    ? 'Start at once'
                    : `${bars} bar${bars === 1 ? '' : 's'} of click before the take`
                }
                onClick={() =>
                  onUpdate((draft) => {
                    draft.metronome.countInBars = bars;
                  }, 'record-settings')
                }
              >
                {bars === 0 ? 'None' : bars === 1 ? '1 bar' : '2 bars'}
              </Chip>
            ))}
          </Row>
          <Row label="Click during recording">
            <Chip
              active={project.metronome.enabled}
              title="Metronome click while recording and playing (K)"
              onClick={() =>
                onUpdate((draft) => {
                  draft.metronome.enabled = !draft.metronome.enabled;
                }, 'record-settings')
              }
            >
              {project.metronome.enabled ? 'On' : 'Off'}
            </Chip>
          </Row>
          <p className="numeric text-[11px] text-mid">
            {project.bpm} BPM · {project.timeSignature.beatsPerBar}/{project.timeSignature.beatUnit}{' '}
            <span className="text-low">— set them in the control bar</span>
          </p>
          <p className="mt-auto text-[10px] leading-snug text-low">
            Takes are shifted earlier by the output + input latency the browser reports.
          </p>
        </Card>

        {/* ── 4 · record ────────────────────────────────────────────────── */}
        <Card step={4} title="Record" className="lg:w-[180px] lg:shrink-0">
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-1">
            <button
              type="button"
              onClick={onToggleRecord}
              disabled={!isRecording && blocked !== null}
              aria-pressed={isRecording}
              aria-label={isRecording ? 'Stop recording (R)' : 'Record (R)'}
              title={
                isRecording ? 'Stop recording (R)' : (blocked ?? 'Record into the armed track (R)')
              }
              className={`flex h-16 w-16 items-center justify-center rounded-full border-2 transition-colors ${
                isRecording
                  ? 'border-danger bg-danger text-page'
                  : 'border-danger/60 bg-chrome-1 text-danger hover:bg-danger/15 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-chrome-1'
              }`}
            >
              {isRecording ? (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <rect x="4" y="4" width="12" height="12" rx="1" />
                </svg>
              ) : (
                <svg width="26" height="26" viewBox="0 0 26 26" fill="currentColor" aria-hidden>
                  <circle cx="13" cy="13" r="11" />
                </svg>
              )}
            </button>
            <div className="flex items-center gap-1.5">
              {isRecording ? (
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 animate-pulse rounded-full bg-danger motion-reduce:animate-none"
                />
              ) : null}
              <span className="text-xs font-semibold text-hi">
                {isRecording ? 'Stop' : 'Record'}
              </span>
              <kbd className="numeric rounded-[3px] border border-hairline px-1 text-[9px] text-low">
                R
              </kbd>
            </div>
            <p role="status" className="numeric text-center text-[11px] leading-snug text-mid">
              {isRecording
                ? transport.state === 'counting'
                  ? 'Count-in…'
                  : elapsedLabel(transport.beat, recording.startBeat, beatsPerBar)
                : (blocked ?? `Starts at bar ${startBar}`)}
            </p>
            {!isRecording && blocked === null ? (
              <p className="numeric text-center text-[10px] leading-snug text-low">
                {project.metronome.countInBars === 0
                  ? 'no count-in'
                  : `${project.metronome.countInBars} bar count-in`}
                {' · '}
                {project.metronome.enabled ? 'click on' : 'click off'}
              </p>
            ) : null}
          </div>
        </Card>

        {/* ── 5 · takes ─────────────────────────────────────────────────── */}
        <Card
          step={5}
          title="Takes"
          hint={takes.length === 0 ? 'none yet' : `${takes.length} in this browser`}
          className="lg:min-w-[320px] lg:flex-[1.6]"
        >
          {takes.length === 0 ? (
            <p className="text-xs leading-snug text-mid">
              No takes yet — check the microphone, arm a track and press Record.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {takes.map((take) => (
                <TakeRow
                  key={take.region.id}
                  take={take}
                  beatsPerBar={beatsPerBar}
                  secPerBeat={secPerBeat}
                  onOpenPitch={() => onOpenPitch(take.trackId, take.region.id)}
                  onRename={(name) => renameTake(take, name)}
                  onDelete={() => deleteTake(take)}
                />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── 1 · input card ───────────────────────────────────────────────────────────

function InputCard({
  engine,
  audioTake,
  className,
}: {
  engine: DawEngine;
  /** A take with audio capture is running: the microphone belongs to it. */
  audioTake: boolean;
  className: string;
}): React.JSX.Element {
  const wide = useWideLayout();
  const { canvasRef, readoutRef, micOpen } = useInputMeter(engine);
  const [busy, setBusy] = useState(false);
  const [monitoring, setMonitoring] = useState(() => engine.isInputMonitoring());
  const [error, setError] = useState<string | null>(null);
  // Open and not taken by a recording = the level check owns the microphone.
  const checking = micOpen && !audioTake;

  const check = (): void => {
    setError(null);
    setBusy(true);
    engine
      .startInputCheck()
      .catch((e: unknown) => setError(describeMicError(e)))
      .finally(() => setBusy(false));
  };

  const status = audioTake ? 'Recording — live input' : micOpen ? 'Listening' : 'Microphone closed';

  return (
    <Card step={1} title="Input" hint={status} className={className}>
      <div className={`flex gap-3 ${wide ? 'flex-row' : 'flex-col'}`}>
        <div className={`flex items-center gap-1 ${wide ? 'flex-col' : 'w-full flex-row'}`}>
          <canvas
            ref={canvasRef}
            width={wide ? 56 : 240}
            height={wide ? 160 : 36}
            className={`numeric rounded-[2px] ${wide ? 'h-40 w-14' : 'h-9 min-w-0 flex-1'}`}
            aria-hidden
          />
          <span
            ref={readoutRef}
            className="numeric shrink-0 text-[10px] text-low"
            aria-label="Peak level"
            role="status"
          >
            -∞
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="numeric text-[10px] tracking-[0.1em] text-mid uppercase">{status}</p>
          {checking ? (
            <SmallButton onClick={() => engine.stopInputCheck()} title="Close the microphone">
              Close
            </SmallButton>
          ) : (
            <SmallButton
              onClick={check}
              disabled={busy || audioTake}
              title={
                audioTake
                  ? 'The microphone is in use by the take'
                  : 'Open the microphone to see your level (no recording)'
              }
            >
              {busy ? 'Opening…' : 'Check microphone'}
            </SmallButton>
          )}
          <button
            type="button"
            aria-pressed={monitoring}
            onClick={() => {
              const next = !monitoring;
              engine.setInputMonitoring(next);
              setMonitoring(next);
            }}
            title="Route the microphone to the speakers while checking and recording"
            className={chipClass(monitoring)}
          >
            Monitor {monitoring ? 'on' : 'off'}
          </button>
          <p className="text-[10px] leading-snug text-low">
            hear yourself through the speakers — use headphones
          </p>
          {error ? (
            <p role="alert" className="text-[11px] leading-snug text-danger">
              {error}
            </p>
          ) : null}
          <p className="mt-auto text-[10px] leading-snug text-low">
            Aim for peaks around −12 dB; the light above the meter means clipping.
          </p>
        </div>
      </div>
    </Card>
  );
}

function describeMicError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
      return "Microphone permission was denied — allow it in the browser's site settings and try again.";
    }
    if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') {
      return 'No microphone was found — plug one in or choose an input in the system sound settings.';
    }
    if (e.name === 'NotReadableError') return 'The microphone is busy in another app.';
  }
  return e instanceof Error && e.message !== '' ? e.message : 'The microphone could not be opened.';
}

// ── the single meter loop ────────────────────────────────────────────────────

interface MeterState {
  holdDb: number;
  holdUntil: number;
  clipUntil: number;
  lastText: string;
  open: boolean | null;
  colors: MeterColors | null;
  colorsAt: number;
}

interface MeterColors {
  trough: string;
  tick: string;
  label: string;
  rms: string;
  peak: string;
  hot: string;
  font: string;
}

function useInputMeter(engine: DawEngine): {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  readoutRef: React.RefObject<HTMLSpanElement | null>;
  micOpen: boolean;
} {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const readoutRef = useRef<HTMLSpanElement | null>(null);
  const [micOpen, setMicOpen] = useState(false);

  useEffect(() => {
    const state: MeterState = {
      holdDb: -Infinity,
      holdUntil: 0,
      clipUntil: 0,
      lastText: '',
      open: null,
      colors: null,
      colorsAt: 0,
    };
    let raf = 0;
    const draw = (now: number): void => {
      const level = engine.getInputLevel();
      const open = level !== null;
      if (open !== state.open) {
        state.open = open;
        setMicOpen(open);
      }
      const canvas = canvasRef.current;
      const g = canvas?.getContext('2d') ?? null;
      if (canvas && g) {
        // Re-read the theme colours about once a second (light/dark switch).
        if (!state.colors || now - state.colorsAt > 1000) {
          state.colors = readColors(canvas);
          state.colorsAt = now;
        }
        drawInputMeter(
          g,
          canvas,
          state,
          level?.peakDb ?? -Infinity,
          level?.rmsDb ?? -Infinity,
          now,
          state.colors,
        );
      }
      const text = state.holdDb > RECORD_METER_MIN_DB ? `${state.holdDb.toFixed(1)} dB` : '-∞';
      if (text !== state.lastText) {
        state.lastText = text;
        if (readoutRef.current) readoutRef.current.textContent = text;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      // Leaving the tab closes the level check (a running take keeps its own mic).
      engine.stopInputCheck();
    };
  }, [engine]);

  return { canvasRef, readoutRef, micOpen };
}

function readColors(el: Element): MeterColors {
  const styles = getComputedStyle(el);
  const v = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    trough: v('--page', '#0c0b14'),
    tick: v('--hairline', '#2a2836'),
    label: v('--text-low', '#5f5b70'),
    rms: v('--accent-state', '#c89b5f'),
    peak: v('--text-mid', '#9a96a8'),
    hot: v('--danger', '#c4574f'),
    font: styles.fontFamily || 'ui-monospace, monospace',
  };
}

function tickLabel(db: number): string {
  return db === 0 ? '0' : `−${-db}`;
}

/** Peak (grey) and RMS (amber) bars, red above 0 dBFS, peak hold, clip light, labelled ticks. */
function drawInputMeter(
  g: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  state: MeterState,
  peakDb: number,
  rmsDb: number,
  now: number,
  colors: MeterColors,
): void {
  if (peakDb >= state.holdDb || now > state.holdUntil) {
    state.holdDb = peakDb;
    state.holdUntil = now + RECORD_PEAK_HOLD_MS;
  }
  if (peakDb > RECORD_CLIP_DB) state.clipUntil = now + RECORD_PEAK_HOLD_MS;

  // Draw in CSS pixels on a device-pixel backing store so the labels stay crisp.
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.width / dpr;
  const h = canvas.clientHeight || canvas.height / dpr;
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.font = `9px ${colors.font}`;

  const clipped = now < state.clipUntil;
  const holdColor = state.holdDb > 0 ? colors.hot : colors.rms;

  if (h > w) {
    // Vertical: bars grow upwards, clip light on top, ticks and labels to the right.
    const clipH = 4;
    const barW = 11;
    const barsW = barW * 2 + 1;
    const top = clipH + 3;
    const bottom = h - 2;
    const meterH = bottom - top;
    const y = (db: number): number => top + meterH * (1 - dbToMeterPos(db));
    g.fillStyle = colors.trough;
    g.fillRect(0, top, barsW, meterH);
    g.fillStyle = clipped ? colors.hot : colors.tick;
    g.fillRect(0, 0, barsW, clipH);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    for (const tick of RECORD_METER_TICKS) {
      const ty = Math.round(y(tick));
      g.fillStyle = colors.tick;
      g.fillRect(barsW + 2, ty, 4, 1);
      g.fillStyle = colors.label;
      g.fillText(tickLabel(tick), barsW + 8, ty + 0.5);
    }
    const zero = y(0);
    const bar = (x: number, db: number, color: string): void => {
      if (!(db > RECORD_METER_MIN_DB)) return;
      const barTop = y(db);
      const base = Math.max(barTop, zero);
      g.fillStyle = color;
      g.fillRect(x, base, barW, bottom - base);
      if (barTop < zero) {
        g.fillStyle = colors.hot;
        g.fillRect(x, barTop, barW, zero - barTop);
      }
    };
    bar(0, peakDb, colors.peak);
    bar(barW + 1, rmsDb, colors.rms);
    if (state.holdDb > RECORD_METER_MIN_DB) {
      g.fillStyle = holdColor;
      g.fillRect(0, Math.round(y(state.holdDb)), barsW, 1);
    }
    return;
  }

  // Horizontal: bars grow to the right, clip light at the right end, ticks below.
  const clipW = 4;
  const barH = 9;
  const barsH = barH * 2 + 1;
  const left = 1;
  const right = w - clipW - 3;
  const meterW = right - left;
  const x = (db: number): number => left + meterW * dbToMeterPos(db);
  g.fillStyle = colors.trough;
  g.fillRect(left, 0, meterW, barsH);
  g.fillStyle = clipped ? colors.hot : colors.tick;
  g.fillRect(w - clipW, 0, clipW, barsH);
  g.textAlign = 'center';
  g.textBaseline = 'top';
  for (const tick of RECORD_METER_TICKS) {
    const tx = Math.round(x(tick));
    g.fillStyle = colors.tick;
    g.fillRect(tx, barsH + 2, 1, 4);
    g.fillStyle = colors.label;
    g.fillText(tickLabel(tick), tx + 0.5, barsH + 7);
  }
  const zero = x(0);
  const bar = (yTop: number, db: number, color: string): void => {
    if (!(db > RECORD_METER_MIN_DB)) return;
    const end = x(db);
    g.fillStyle = color;
    g.fillRect(left, yTop, Math.min(end, zero) - left, barH);
    if (end > zero) {
      g.fillStyle = colors.hot;
      g.fillRect(zero, yTop, end - zero, barH);
    }
  };
  bar(0, peakDb, colors.peak);
  bar(barH + 1, rmsDb, colors.rms);
  if (state.holdDb > RECORD_METER_MIN_DB) {
    g.fillStyle = holdColor;
    g.fillRect(Math.round(x(state.holdDb)), 0, 1, barsH);
  }
}

// ── layout breakpoint ────────────────────────────────────────────────────────

function subscribeWide(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function readWide(): boolean {
  return typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_QUERY).matches : true;
}

/** True at the lg breakpoint and up: cards in a row, vertical meter. */
function useWideLayout(): boolean {
  return useSyncExternalStore(subscribeWide, readWide, () => true);
}

// ── 5 · take row ─────────────────────────────────────────────────────────────

function TakeRow({
  take,
  beatsPerBar,
  secPerBeat,
  onOpenPitch,
  onRename,
  onDelete,
}: {
  take: RecordableTake;
  beatsPerBar: number;
  secPerBeat: number;
  onOpenPitch: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const cancelledRef = useRef(false);
  const { region, trackName } = take;
  const bar = Math.floor(region.startBeat / beatsPerBar + EPS) + 1;
  const seconds = region.lengthBeats * secPerBeat;

  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[4px] border border-hairline bg-chrome-1 px-2 py-1.5">
      <div className="flex min-w-[140px] flex-1 flex-col gap-0.5">
        {editing ? (
          <input
            defaultValue={region.name}
            autoFocus
            maxLength={80}
            aria-label={`Rename ${region.name}`}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
              if (!cancelledRef.current) onRename(e.currentTarget.value);
              cancelledRef.current = false;
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                cancelledRef.current = true;
                e.currentTarget.blur();
              }
            }}
            className="h-8 w-full rounded-[3px] border border-hairline bg-chrome-2 px-1.5 text-xs text-hi outline-none focus:border-accent-state"
          />
        ) : (
          <span className="truncate text-xs font-semibold text-hi" title={region.name}>
            {region.name}
          </span>
        )}
        <span className="numeric truncate text-[10px] text-low">
          {trackName} · bar {bar} · {formatSeconds(seconds)}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <SmallButton onClick={onOpenPitch} title="Measure this take's pitch in the Pitch tab">
          Pitch
        </SmallButton>
        <SmallButton onClick={() => setEditing(true)} disabled={editing} title="Rename this take">
          Rename
        </SmallButton>
        <SmallButton
          onClick={onDelete}
          danger
          title="Delete this take from its track (undo with ⌘Z)"
        >
          Delete
        </SmallButton>
      </div>
    </li>
  );
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0.0 s';
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
}

// ── shared chrome ────────────────────────────────────────────────────────────

function Card({
  step,
  title,
  hint,
  className,
  children,
}: {
  step: number;
  title: string;
  hint?: string | undefined;
  className: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      aria-label={`${step}. ${title}`}
      className={`flex min-w-0 flex-col gap-2 rounded-[4px] border border-hairline bg-chrome-2 p-3 ${className}`}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="numeric text-[10px] tracking-[0.14em] text-accent-state uppercase">
          <span className="text-low">{step} · </span>
          {title}
        </h3>
        {hint ? (
          <span className="numeric truncate text-[9px] tracking-[0.1em] text-low uppercase">
            {hint}
          </span>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
      <span className="text-[11px] text-mid">{label}</span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

function chipClass(active: boolean): string {
  return `numeric h-8 rounded-[4px] border px-2 text-[10px] tracking-[0.08em] uppercase transition-colors ${
    active
      ? 'border-accent-state bg-accent-state/15 text-accent-state'
      : 'border-hairline text-low hover:text-hi'
  }`;
}

function Chip({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={chipClass(active)}
    >
      {children}
    </button>
  );
}

function SmallButton({
  onClick,
  title,
  disabled = false,
  danger = false,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`h-8 rounded-[4px] border px-2 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? 'border-hairline text-mid hover:border-danger hover:text-danger'
          : 'border-hairline text-mid hover:border-accent-state hover:text-hi'
      }`}
    >
      {children}
    </button>
  );
}
