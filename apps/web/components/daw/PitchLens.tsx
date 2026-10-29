'use client';

/**
 * PitchLens — the bottom panel's "Pitch" tab for an audio region: measured f0
 * against the fitted pentatonic grid (lib/daw/pitch.ts), the per-degree tuning
 * profile, and two actions that put the measurement to work — the measured
 * melody as an oud MIDI track, and the fit as the project's scale lock.
 *
 * Everything runs in this browser on the decoded region; nothing is uploaded.
 * Results are estimates (YIN, not the research CREPE scorer) and are labelled
 * so: measured deviations stay visible, off-scale notes are marked, never
 * corrected.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DawEngine } from '@/lib/daw/engine';
import { analysePitch, hzToCents, type PitchAnalysis } from '@/lib/daw/pitch';
import { ROOT_NAMES, midiName } from '@/lib/daw/scales';
import { transcriptionToTrack, type Transcription } from '@/lib/daw/transcriptionImport';
import type { DawAudioRegion } from '@/lib/daw/types';
import type { UpdateFn } from './DawApp';
import { PracticePlayer } from './PracticePlayer';

/** Longest span analysed at once (seconds) — keeps the tab responsive. */
const MAX_SPAN_SEC = 600;

/** Analyses survive tab switches and reselection; keyed by what was measured. */
const cache = new Map<string, PitchAnalysis>();

function spanOf(
  region: DawAudioRegion,
  secPerBeat: number,
  fileSec: number,
): { startSec: number; endSec: number; capped: boolean } {
  const startSec = Math.max(0, region.offsetSec);
  const wanted = Math.min(fileSec, startSec + region.lengthBeats * secPerBeat);
  const endSec = Math.min(wanted, startSec + MAX_SPAN_SEC);
  return { startSec, endSec, capped: endSec < wanted };
}

function keyOf(region: DawAudioRegion, secPerBeat: number): string {
  return `${region.source}|${region.offsetSec.toFixed(3)}|${(region.lengthBeats * secPerBeat).toFixed(3)}`;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'running'; progress: number }
  | { kind: 'error'; message: string };

export function PitchLens({
  engine,
  region,
  secPerBeat,
  onUpdate,
  onNotice,
}: {
  engine: DawEngine;
  region: DawAudioRegion;
  secPerBeat: number;
  onUpdate: UpdateFn;
  onNotice: (message: string) => void;
}): React.JSX.Element {
  const key = keyOf(region, secPerBeat);
  const [analysis, setAnalysis] = useState<PitchAnalysis | null>(() => cache.get(key) ?? null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [capped, setCapped] = useState(false);
  const [includeOffScale, setIncludeOffScale] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setAnalysis(cache.get(key) ?? null);
    setStatus({ kind: 'idle' });
    return () => abortRef.current?.abort();
  }, [key]);

  const run = useCallback(async (): Promise<void> => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      setStatus({ kind: 'loading' });
      let buffer = engine.getAudioBuffer(region.source);
      if (!buffer) {
        await engine.loadAudio(region.source);
        buffer = engine.getAudioBuffer(region.source);
      }
      if (!buffer) throw new Error('The audio for this region could not be decoded.');
      const span = spanOf(region, secPerBeat, buffer.duration);
      if (span.endSec - span.startSec < 0.5)
        throw new Error('The region is shorter than half a second.');
      setCapped(span.capped);
      const channels: Float32Array[] = [];
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch));
      setStatus({ kind: 'running', progress: 0 });
      const result = await analysePitch(channels, buffer.sampleRate, span, {
        signal: ctrl.signal,
        onProgress: (p) => setStatus({ kind: 'running', progress: p }),
      });
      cache.set(key, result);
      setAnalysis(result);
      setStatus({ kind: 'idle' });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatus({ kind: 'idle' });
        return;
      }
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Analysis failed.',
      });
    }
  }, [engine, key, region, secPerBeat]);

  const addTrack = useCallback((): void => {
    if (!analysis || analysis.notes.length === 0) return;
    const transcription: Transcription = {
      title: `${region.name} — measured melody`,
      unit: 'seconds',
      bpm: null,
      notes: analysis.notes.map((n) => ({
        start: n.start,
        end: n.end,
        midi: n.midi,
        velocity: Math.max(0.3, Math.min(1, (n.db + 50) / 40)),
        marked: n.offScale,
      })),
    };
    const kept = includeOffScale
      ? analysis.notes.length
      : analysis.notes.filter((n) => !n.offScale).length;
    onUpdate((draft) => {
      draft.tracks.push(
        transcriptionToTrack(transcription, draft, 'oud', {
          startBeat: region.startBeat,
          skipMarked: !includeOffScale,
        }),
      );
    });
    onNotice(`Added ${kept} measured notes as an Oud track, aligned to the region.`);
  }, [analysis, includeOffScale, onNotice, onUpdate, region.name, region.startBeat]);

  const applyScale = useCallback((): void => {
    const fit = analysis?.fit;
    if (!fit) return;
    onUpdate((draft) => {
      draft.scaleLock = { enabled: true, root: fit.tonic, mode: fit.mode };
    });
    onNotice(`Scale lock set to ${ROOT_NAMES[fit.tonic]} ${fit.modeLabel.toLowerCase()}.`);
  }, [analysis, onNotice, onUpdate]);

  const busy = status.kind === 'loading' || status.kind === 'running';
  const btn =
    'numeric rounded-[4px] border px-3 py-1.5 text-[11px] tracking-[0.14em] uppercase transition-colors disabled:opacity-40';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-2">
        {busy ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className={`${btn} border-hairline text-low hover:text-hi`}
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void run()}
            className={`${btn} border-accent-state text-accent-state hover:bg-chrome-2`}
          >
            {analysis ? 'Re-analyse' : 'Analyse pitch'}
          </button>
        )}
        <PracticePlayer engine={engine} region={region} secPerBeat={secPerBeat} />
        <span className="numeric text-[11px] text-low" role="status" aria-live="polite">
          {status.kind === 'loading'
            ? 'Decoding audio…'
            : status.kind === 'running'
              ? `Measuring pitch… ${Math.round(status.progress * 100)} %`
              : status.kind === 'error'
                ? ''
                : analysis
                  ? `${region.name} · ${analysis.durationSec.toFixed(1)} s measured${capped ? ` (first ${MAX_SPAN_SEC / 60} min)` : ''}`
                  : 'Measures the region in this browser. Nothing is uploaded.'}
        </span>
        {status.kind === 'error' ? (
          <span className="text-[12px] text-danger" role="alert">
            {status.message}
          </span>
        ) : null}
        {analysis ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="numeric flex items-center gap-1.5 text-[10px] tracking-[0.1em] text-low uppercase">
              <input
                type="checkbox"
                checked={includeOffScale}
                onChange={(e) => setIncludeOffScale(e.target.checked)}
                className="accent-(--accent-state)"
              />
              keep off-scale notes
            </label>
            <button
              type="button"
              onClick={addTrack}
              disabled={analysis.notes.length === 0}
              className={`${btn} border-hairline text-hi hover:border-accent-state`}
            >
              Melody → Oud track
            </button>
            <button
              type="button"
              onClick={applyScale}
              disabled={!analysis.fit}
              className={`${btn} border-hairline text-hi hover:border-accent-state`}
            >
              Use as scale lock
            </button>
          </div>
        ) : null}
      </div>

      {analysis ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 lg:flex-row">
          <Summary analysis={analysis} />
          <Contour
            analysis={analysis}
            onSeek={(t) => engine.seek(region.startBeat + t / secPerBeat)}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="max-w-xl text-sm text-low">
            {busy
              ? ' '
              : 'Pitch analysis finds the recording’s tuning offset, fits the five-note scale it uses, and shows how far each degree sits from equal temperament, without correcting it. Run it on an imported recording, a take, or a QaraamiGen loop.'}
          </p>
        </div>
      )}
    </div>
  );
}

function Summary({ analysis }: { analysis: PitchAnalysis }): React.JSX.Element {
  const { fit, notes, offsetCents } = analysis;
  const meanConf =
    notes.length > 0 ? notes.reduce((s, n) => s + n.confidence, 0) / notes.length : 0;
  const offScale = notes.filter((n) => n.offScale).length;
  const stat = 'numeric flex flex-col gap-0.5 text-[10px] tracking-[0.14em] text-low uppercase';
  const val = 'text-sm tracking-normal text-hi normal-case';
  return (
    <section aria-label="Pitch summary" className="flex shrink-0 flex-col gap-3 lg:w-80">
      {fit ? (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div className={stat}>
              Scale (estimate)
              <span className={val}>
                {ROOT_NAMES[fit.tonic]} {fit.modeLabel.toLowerCase()}
                {fit.tonicAmbiguous ? ' · tonic ambiguous' : ''}
              </span>
            </div>
            <div className={stat}>
              Tuning offset
              <span className={val}>
                {offsetCents >= 0 ? '+' : '−'}
                {Math.abs(offsetCents).toFixed(0)} c from A440
              </span>
            </div>
            <div className={stat}>
              Within ¼ tone of scale
              <span className={val}>
                {Math.round(fit.withinQuarterTone * 100)} % of voiced frames
              </span>
            </div>
            <div className={stat}>
              Notes found
              <span className={val}>
                {notes.length}
                {offScale > 0 ? ` · ${offScale} off-scale, marked` : ''}
              </span>
            </div>
          </div>
          <table className="numeric w-full text-left text-[11px]">
            <caption className="pb-1 text-left text-[10px] tracking-[0.14em] text-low uppercase">
              Measured degrees vs equal temperament
            </caption>
            <thead className="text-low">
              <tr>
                <th className="font-normal">Degree</th>
                <th className="font-normal">Note</th>
                <th className="font-normal">Deviation</th>
                <th className="font-normal">Share</th>
              </tr>
            </thead>
            <tbody className="text-hi">
              {fit.profile.map((d, i) => (
                <tr key={d.template} className="border-t border-hairline">
                  <td className="py-0.5">{i + 1}</td>
                  <td>{ROOT_NAMES[(fit.tonic + d.template) % 12]}</td>
                  <td
                    className={
                      d.deviationCents !== null && Math.abs(d.deviationCents) >= 20
                        ? 'text-accent-state'
                        : ''
                    }
                  >
                    {d.deviationCents === null
                      ? 'too sparse'
                      : `${d.deviationCents >= 0 ? '+' : '−'}${Math.abs(d.deviationCents).toFixed(0)} c`}
                  </td>
                  <td>{Math.round(d.share * 100)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="text-sm text-low">
          Too little stable pitch to fit a scale (under 20 voiced frames). Percussion, speech or
          dense mixes often measure this way.
        </p>
      )}
      <p className="text-[11px] leading-relaxed text-low">
        Estimates from this browser (YIN pitch tracking), with mean note confidence{' '}
        {Math.round(meanConf * 100)} %. Deviations are measured after removing the tuning offset; a
        degree sung consistently away from equal temperament is the performer’s tuning, not an
        error. The scale fit names the five-note set the pitches use; it is not a ruling on the
        tradition.
      </p>
    </section>
  );
}

function Contour({
  analysis,
  onSeek,
}: {
  analysis: PitchAnalysis;
  onSeek: (t: number) => void;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [readout, setReadout] = useState<string>(
    'Click to move the playhead; hover to read a frame.',
  );
  const { frames, fit, offsetCents, notes, durationSec } = analysis;

  // Y axis: cents above the tonic (offset removed), padded to whole semitones.
  const tonicRef = fit ? (fit.tonic - 9) * 100 + offsetCents : offsetCents; // cents above A4 of the tonic's pitch class
  const rel = (hz: number): number => hzToCents(hz) - tonicRef;
  const voiced = frames.filter((f) => f.hz !== null);
  const values = voiced.map((f) => rel(f.hz!)).sort((a, b) => a - b);
  const lo = Math.floor(((values[Math.floor(values.length * 0.02)] ?? -1200) - 150) / 100) * 100;
  const hi = Math.ceil(((values[Math.floor(values.length * 0.98)] ?? 0) + 150) / 100) * 100;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = (): void => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      const css = getComputedStyle(canvas);
      const color = (name: string, fallback: string): string =>
        css.getPropertyValue(name).trim() || fallback;
      const accent = color('--accent-state', '#c89b5f');
      const hair = color('--hairline', '#2a2836');
      const low = color('--text-low', '#5f5b70');
      const hiText = color('--text-hi', '#edeaf2');
      const x = (t: number): number => (t / Math.max(0.001, durationSec)) * w;
      const y = (c: number): number => h - ((c - lo) / Math.max(1, hi - lo)) * h;
      ctx.clearRect(0, 0, w, h);
      ctx.font = '10px ui-monospace, monospace';
      // 12-TET semitone lines (faint).
      ctx.strokeStyle = hair;
      ctx.lineWidth = 1;
      for (let c = lo; c <= hi; c += 100) {
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y(c)) + 0.5);
        ctx.lineTo(w, Math.round(y(c)) + 0.5);
        ctx.stroke();
      }
      // Measured pentatonic degrees (where the performer actually puts them).
      if (fit) {
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = accent;
        ctx.fillStyle = accent;
        let lastLabelY = Number.POSITIVE_INFINITY;
        for (let oct = Math.floor(lo / 1200) - 1; oct <= Math.ceil(hi / 1200); oct++) {
          for (const d of fit.profile) {
            const c = oct * 1200 + d.template * 100 + (d.deviationCents ?? 0);
            if (c < lo || c > hi) continue;
            ctx.globalAlpha = d.deviationCents === null ? 0.35 : 0.8;
            ctx.beginPath();
            ctx.moveTo(0, y(c));
            ctx.lineTo(w, y(c));
            ctx.stroke();
            // Lines run upward; label only when there is room for the text.
            if (lastLabelY - y(c) >= 12) {
              ctx.fillText(
                midiName(60 + fit.tonic + d.template + oct * 12).replace(/-?\d+$/, ''),
                4,
                y(c) - 3,
              );
              lastLabelY = y(c);
            }
          }
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      // Segmented notes as faint bars.
      ctx.fillStyle = low;
      ctx.globalAlpha = 0.35;
      for (const n of notes) {
        const c = (n.midi - 69) * 100 + offsetCents - tonicRef + n.deviationCents;
        ctx.fillRect(x(n.start), y(c) - 2, Math.max(1, x(n.end) - x(n.start)), 4);
      }
      // f0 frames, opacity by clarity.
      ctx.fillStyle = hiText;
      for (const f of voiced) {
        ctx.globalAlpha = Math.max(0.15, Math.min(1, (f.clarity - 0.6) / 0.4));
        ctx.fillRect(x(f.t) - 1, y(rel(f.hz!)) - 1, 2, 2);
      }
      ctx.globalAlpha = 1;
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
    // rel/tonicRef derive from analysis; redraw when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, lo, hi]);

  const frameAt = (clientX: number): { t: number; frame: (typeof frames)[number] | null } => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { t: 0, frame: null };
    const t = ((clientX - rect.left) / rect.width) * durationSec;
    let best: (typeof frames)[number] | null = null;
    for (const f of frames) if (!best || Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
    return { t, frame: best };
  };

  return (
    <section
      aria-label="Pitch contour"
      className="flex min-h-[180px] min-w-0 flex-1 flex-col gap-1"
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Measured pitch over ${durationSec.toFixed(1)} seconds, with the fitted scale degrees as dashed lines`}
        className="min-h-[160px] w-full flex-1 cursor-crosshair rounded-[4px] border border-hairline bg-page"
        onPointerMove={(e) => {
          const { t, frame } = frameAt(e.clientX);
          if (!frame || frame.hz === null) {
            setReadout(`${t.toFixed(2)} s · unvoiced`);
            return;
          }
          const c = rel(frame.hz);
          let nearest = '';
          if (fit) {
            const pos = ((c % 1200) + 1200) % 1200;
            let bestD = Number.POSITIVE_INFINITY;
            for (const d of fit.profile) {
              const centre = d.template * 100 + (d.deviationCents ?? 0);
              let dv = pos - centre;
              if (dv > 600) dv -= 1200;
              if (dv < -600) dv += 1200;
              if (Math.abs(dv) < Math.abs(bestD)) {
                bestD = dv;
                nearest = `${ROOT_NAMES[(fit.tonic + d.template) % 12]} ${dv >= 0 ? '+' : '−'}${Math.abs(dv).toFixed(0)} c`;
              }
            }
          }
          setReadout(
            `${t.toFixed(2)} s · ${frame.hz.toFixed(1)} Hz · ${nearest ? `nearest degree ${nearest}` : ''} · confidence ${Math.round(frame.clarity * 100)} %`,
          );
        }}
        onClick={(e) => onSeek(frameAt(e.clientX).t)}
      />
      <p className="numeric text-[10px] text-low" aria-live="off">
        {readout}
      </p>
    </section>
  );
}
