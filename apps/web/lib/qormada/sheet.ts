/**
 * Qormada in the browser: a pitch analysis (lib/daw/pitch.ts) → sheet music.
 * Repeated plucks are split, the tempo is estimated from the onsets (or set by
 * the musician), the melody is quantized and written as MusicXML. Pure: the
 * page re-runs it on every option change without analysing the audio again.
 */

import type { PitchAnalysis } from '@/lib/daw/pitch';
import { ENVELOPE_HOP_SEC } from './melody';
import { keyFifths, spell, toMusicXml } from './musicxml';
import { splitRepeatedNotes } from './onsets';
import { quantize, type TimedNote } from './quantize';
import { estimateTempo, estimateTempoFromEnvelope } from './tempo';

export interface SheetOptions {
  title: string;
  /** Musician's tempo; null = use the estimate. */
  bpm: number | null;
  beatsPerBar: number;
  /** Semitones, applied to every note and to the key. */
  transpose: number;
  showCents: boolean;
  includeOffScale: boolean;
  /** Join gaps shorter than a beat to the previous note. */
  legato: boolean;
}

export interface SheetResult {
  xml: string;
  bpm: number;
  estimatedBpm: number | null;
  tempoConfidence: number | null;
  notes: number;
  offScale: number;
  measures: number;
  dropped: number;
  /** e.g. "E suspended pentatonic", in the written (transposed) key. */
  scaleName: string | null;
}

const FALLBACK_BPM = 90;

/** Notes ready for notation: plucks split, from an analysis. */
export function melodyNotes(analysis: PitchAnalysis): TimedNote[] {
  return splitRepeatedNotes(analysis.notes, analysis.frames);
}

function pcName(pc: number, fifths: number): string {
  const s = spell(60 + pc, fifths);
  return s.step + (s.alter === 1 ? '♯' : s.alter === -1 ? '♭' : '');
}

export function buildSheet(
  analysis: PitchAnalysis & { envelope?: Float32Array },
  notes: readonly TimedNote[],
  opts: SheetOptions,
): SheetResult {
  const kept = opts.includeOffScale ? notes : notes.filter((n) => !n.offScale);
  // The whole recording's attacks (drums, plucks) when available; else the melody's onsets.
  const tempo =
    (analysis.envelope ? estimateTempoFromEnvelope(analysis.envelope, ENVELOPE_HOP_SEC) : null) ??
    estimateTempo(kept.map((n) => n.start));
  const bpm = opts.bpm ?? tempo?.bpm ?? FALLBACK_BPM;
  const phaseSec = opts.bpm === null && tempo ? tempo.phaseSec : (kept[0]?.start ?? 0);
  const shifted = kept.map((n) => ({ ...n, midi: n.midi + opts.transpose }));
  const score = quantize(shifted, {
    bpm,
    phaseSec,
    beatsPerBar: opts.beatsPerBar,
    fillGaps: opts.legato ? 3 : 0,
  });

  const fit = analysis.fit;
  const scalePcs = fit
    ? fit.degrees.map((d) => (((fit.tonic + d + opts.transpose) % 12) + 12) % 12)
    : null;
  const fifths = scalePcs ? keyFifths(scalePcs) : 0;
  const scaleName =
    fit && scalePcs ? `${pcName(scalePcs[0]!, fifths)} ${fit.modeLabel.toLowerCase()}` : null;
  const offset = Math.round(analysis.offsetCents);
  const tuning = `tuning ${offset === 0 ? '±' : offset > 0 ? '+' : '−'}${Math.abs(offset)} c from A440`;
  const caption = [
    scaleName,
    tuning,
    opts.transpose !== 0 ? `transposed ${opts.transpose > 0 ? '+' : ''}${opts.transpose}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const xml = toMusicXml(score, {
    title: opts.title,
    bpm,
    scalePitchClasses: scalePcs,
    caption,
    showCents: opts.showCents,
  });
  return {
    xml,
    bpm,
    estimatedBpm: tempo?.bpm ?? null,
    tempoConfidence: tempo?.confidence ?? null,
    notes: kept.length - score.dropped,
    offScale: kept.filter((n) => n.offScale).length,
    measures: score.measures.length,
    dropped: score.dropped,
    scaleName,
  };
}
