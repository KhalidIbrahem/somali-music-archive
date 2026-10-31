/**
 * Runs the /transcribe page's own pipeline (lib/qormada) on audio files from
 * the command line, for evaluation against annotated datasets. Audio is
 * decoded with ffmpeg to mono float32; the analysis is the code the browser
 * runs, unchanged.
 *
 *   npx tsx scripts/qormada-eval/transcribe.ts --mode melody --out notes.json a.wav b.wav
 *
 * Modes: `melody` (what /transcribe does: direct or bass-high-passed pitch
 * track chosen per recording, octave slips fixed, plucks split), `highpassed`
 * (always the high-passed track, the 2026-10-29 release) and `plain` (the
 * Pitch tab's analysis, no melody mode), kept for the ablation. `--highpass <Hz>` and `--fmin <Hz>` override the melody
 * mode's settings for parameter sweeps. Output: one entry per file with the note events
 * (onset, offset, Hz including the tuning offset and the note's own cents)
 * and the pitch frames (t, Hz or 0 when unvoiced).
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { analysePitch, type PitchAnalysis } from '@/lib/daw/pitch';
import { analyseMelody, type MelodyOptions } from '@/lib/qormada/melody';
import { melodyNotes } from '@/lib/qormada/sheet';

const RATE = 44100;

function decode(path: string): Float32Array {
  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'],
    { maxBuffer: 1 << 30 },
  );
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

export interface EvalNote {
  onset: number;
  offset: number;
  hz: number;
}

export interface EvalResult {
  file: string;
  mode: string;
  seconds: number;
  analysisMs: number;
  offsetCents: number;
  scale: string | null;
  scalePcs: number[] | null;
  source: string | null;
  agreement: number | null;
  notes: EvalNote[];
  frames: [number, number][];
}

async function run(path: string, mode: string, opts: MelodyOptions): Promise<EvalResult> {
  const samples = decode(path);
  const span = { startSec: 0, endSec: samples.length / RATE };
  const t0 = performance.now();
  let analysis: PitchAnalysis;
  let notes;
  if (mode === 'melody' || mode === 'highpassed') {
    analysis = await analyseMelody([samples], RATE, span, {
      ...opts,
      adaptive: mode === 'melody',
    });
    notes = melodyNotes(analysis);
  } else {
    analysis = await analysePitch([samples], RATE, span);
    notes = analysis.notes;
  }
  const analysisMs = performance.now() - t0;
  const off = analysis.offsetCents;
  return {
    file: basename(path),
    mode,
    seconds: span.endSec,
    analysisMs: Math.round(analysisMs),
    offsetCents: Math.round(off * 10) / 10,
    scale: analysis.fit ? `${analysis.fit.tonic} ${analysis.fit.modeLabel}` : null,
    scalePcs: analysis.fit
      ? analysis.fit.degrees.map((d) => (analysis.fit!.tonic + d) % 12).sort((a, b) => a - b)
      : null,
    source: 'source' in analysis ? (analysis as { source: string }).source : null,
    agreement:
      'agreement' in analysis ? (analysis as { agreement: number | null }).agreement : null,
    notes: notes.map((n) => ({
      onset: n.start,
      offset: n.end,
      hz: 440 * 2 ** ((n.midi - 69) / 12 + (off + n.deviationCents) / 1200),
    })),
    frames: analysis.frames.map((f) => [Math.round(f.t * 1e4) / 1e4, f.hz ?? 0]),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let mode = 'melody';
  let out = 'qormada-eval.json';
  const opts: MelodyOptions = {};
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--mode') mode = args[++i] ?? mode;
    else if (a === '--out') out = args[++i] ?? out;
    else if (a === '--highpass') opts.highpassHz = Number(args[++i]);
    else if (a === '--fmin') opts.fminHz = Number(args[++i]);
    else files.push(a);
  }
  if (!['melody', 'highpassed', 'plain'].includes(mode)) throw new Error(`unknown mode ${mode}`);
  const results: EvalResult[] = [];
  for (const f of files) {
    results.push(await run(f, mode, opts));
    process.stderr.write(`${mode} ${results.length}/${files.length} ${basename(f)}\n`);
  }
  writeFileSync(out, JSON.stringify(results));
}

void main();
