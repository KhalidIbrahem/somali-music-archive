'use client';

/**
 * Mixer (Stage 5 Tier 1) — one strip per track: gain fader, pan, mute/solo,
 * live level meter (polls the engine's per-track analysers on rAF, imperative
 * canvas — zero React churn), plus the master fader.
 */

import { useEffect, useRef } from 'react';
import type { DawEngine } from '@/lib/daw/engine';
import { INSTRUMENT_LABELS, type DawProject } from '@/lib/daw/types';

export function Mixer({
  project,
  engine,
  onUpdate,
}: {
  project: DawProject;
  engine: DawEngine;
  onUpdate: (mutate: (draft: DawProject) => void) => void;
}): React.JSX.Element {
  return (
    <div className="flex h-full items-stretch gap-2 overflow-x-auto p-3">
      {project.tracks.map((track) => (
        <div
          key={track.id}
          className="flex w-24 shrink-0 flex-col items-center gap-1.5 rounded-[4px] border border-hairline bg-chrome-2 p-2"
        >
          <span className="w-full truncate text-center text-[11px] font-semibold text-hi">
            {track.name}
          </span>
          <span className="numeric text-[9px] tracking-wide text-low uppercase">
            {INSTRUMENT_LABELS[track.instrument]}
          </span>
          <Meter engine={engine} trackId={track.id} />
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={track.gain}
            aria-label={`${track.name} volume`}
            onChange={(e) =>
              onUpdate((draft) => {
                const t = draft.tracks.find((x) => x.id === track.id);
                if (t) t.gain = Number(e.target.value);
              })
            }
            className="w-full accent-(--accent-state)"
          />
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={track.pan}
            aria-label={`${track.name} pan`}
            onChange={(e) =>
              onUpdate((draft) => {
                const t = draft.tracks.find((x) => x.id === track.id);
                if (t) t.pan = Number(e.target.value);
              })
            }
            className="w-full accent-(--accent-state)"
          />
          <div className="flex gap-1">
            <button
              type="button"
              aria-pressed={track.muted}
              onClick={() =>
                onUpdate((draft) => {
                  const t = draft.tracks.find((x) => x.id === track.id);
                  if (t) t.muted = !t.muted;
                })
              }
              className={`numeric h-6 w-7 rounded-[3px] border text-[10px] ${
                track.muted
                  ? 'border-accent-state bg-accent-state/20 text-accent-state'
                  : 'border-hairline text-low'
              }`}
            >
              M
            </button>
            <button
              type="button"
              aria-pressed={track.solo}
              onClick={() =>
                onUpdate((draft) => {
                  const t = draft.tracks.find((x) => x.id === track.id);
                  if (t) t.solo = !t.solo;
                })
              }
              className={`numeric h-6 w-7 rounded-[3px] border text-[10px] ${
                track.solo
                  ? 'border-accent-state bg-accent-state/20 text-accent-state'
                  : 'border-hairline text-low'
              }`}
            >
              S
            </button>
          </div>
        </div>
      ))}

      {/* master */}
      <div className="flex w-24 shrink-0 flex-col items-center gap-1.5 rounded-[4px] border border-accent-state/40 bg-chrome-2 p-2">
        <span className="text-[11px] font-semibold text-accent-state">Master</span>
        <div className="h-16" />
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.01}
          value={project.masterGain}
          aria-label="Master volume"
          onChange={(e) =>
            onUpdate((draft) => {
              draft.masterGain = Number(e.target.value);
            })
          }
          className="w-full accent-(--accent-state)"
        />
      </div>
    </div>
  );
}

function Meter({ engine, trackId }: { engine: DawEngine; trackId: string }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    const data = new Uint8Array(512);
    const draw = (): void => {
      const canvas = canvasRef.current;
      const analyser = engine.getAnalyser(trackId);
      if (canvas) {
        const g = canvas.getContext('2d');
        if (g) {
          const { width, height } = canvas;
          g.clearRect(0, 0, width, height);
          let rms = 0;
          if (analyser) {
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
              const v = ((data[i] ?? 128) - 128) / 128;
              sum += v * v;
            }
            rms = Math.sqrt(sum / data.length);
          }
          const level = Math.min(1, rms * 2.5);
          const barH = level * height;
          const styles = getComputedStyle(canvas);
          g.fillStyle = styles.getPropertyValue('--chrome-1').trim() || '#14131d';
          g.fillRect(0, 0, width, height);
          g.fillStyle =
            level > 0.85
              ? styles.getPropertyValue('--danger').trim() || '#e5484d'
              : styles.getPropertyValue('--accent-state').trim() || '#C89B5F';
          g.fillRect(0, height - barH, width, barH);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine, trackId]);

  return <canvas ref={canvasRef} width={12} height={64} className="rounded-[2px]" aria-hidden />;
}
