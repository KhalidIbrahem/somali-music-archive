/**
 * Pure timing math for audio regions (Studio v2) — no Web Audio here, so the
 * engine's scheduling rules are unit-testable in Node.
 *
 * Three layers:
 *  1. regionSegments(): a DawAudioRegion → one segment per loop pass, in
 *     timeline seconds, with the file offset and the fade/de-click lengths;
 *  2. transportSpans(): the transport's unfolded time → timeline mapping
 *     (straight, or play-start → loop end, then loop start → loop end …);
 *  3. clipsInWindow(): which source starts the scheduler must issue for an
 *     unfolded window — a segment cut by a span (play from the middle of a
 *     region, loop wrap) starts mid-file at the right offset.
 */

import type { DawAudioRegion } from './types';

/** Ramp used where audio is cut mid-waveform (loop pass joins, seek, loop wrap). */
export const DECLICK_SEC = 0.004;

export interface AudioSegment {
  regionId: string;
  source: string;
  /** Timeline seconds (from beat 0). */
  startSec: number;
  durationSec: number;
  /** Seconds into the file where the segment starts. */
  fileOffsetSec: number;
  gain: number;
  fadeInSec: number;
  fadeOutSec: number;
}

/**
 * Expand a region into one segment per loop pass. Each pass plays
 * [offsetSec, offsetSec + lengthBeats·secPerBeat) of the file; a file shorter
 * than that leaves silence for the rest of the pass. The region's own fades
 * apply at its outer edges (first pass in, last pass out); inner pass joins
 * get a short de-click ramp.
 */
export function regionSegments(
  region: DawAudioRegion,
  secPerBeat: number,
  bufferDurationSec: number,
): AudioSegment[] {
  const passSec = Math.max(0, region.lengthBeats) * secPerBeat;
  const offset = Math.max(0, region.offsetSec);
  const playable = Math.min(passSec, bufferDurationSec - offset);
  const passes = Math.max(1, Math.floor(region.loopCount));
  if (!(playable > 0)) return [];
  const segments: AudioSegment[] = [];
  for (let pass = 0; pass < passes; pass++) {
    const fadeIn = pass === 0 ? Math.max(0, region.fadeInSec) : DECLICK_SEC;
    const fullPass = playable >= passSec - 1e-9;
    // A pass cut short by the end of the file ends naturally: use the region fade.
    const fadeOut = pass === passes - 1 || !fullPass ? Math.max(0, region.fadeOutSec) : DECLICK_SEC;
    const [fi, fo] = clampFades(fadeIn, fadeOut, playable);
    segments.push({
      regionId: region.id,
      source: region.source,
      startSec: (region.startBeat + pass * region.lengthBeats) * secPerBeat,
      durationSec: playable,
      fileOffsetSec: offset,
      gain: Math.max(0, Math.min(2, region.gain)),
      fadeInSec: fi,
      fadeOutSec: fo,
    });
  }
  return segments;
}

/** Scale fades down proportionally when they would overlap. */
export function clampFades(fadeIn: number, fadeOut: number, duration: number): [number, number] {
  const total = fadeIn + fadeOut;
  if (total <= duration || total <= 0) return [fadeIn, fadeOut];
  const k = duration / total;
  return [fadeIn * k, fadeOut * k];
}

export interface TransportSpan {
  /** Unfolded transport seconds at which this span begins. */
  unfoldedStart: number;
  /** Timeline seconds covered: [timelineStart, timelineEnd). */
  timelineStart: number;
  timelineEnd: number;
}

/**
 * The spans of timeline that the transport plays and which overlap the
 * unfolded window [fromUnfolded, toUnfolded). Without a loop there is one
 * open-ended span from the play position.
 */
export function transportSpans(
  playStartSec: number,
  loop: { startSec: number; endSec: number } | null,
  fromUnfolded: number,
  toUnfolded: number,
): TransportSpan[] {
  if (loop === null || loop.endSec - loop.startSec <= 1e-4) {
    return [{ unfoldedStart: 0, timelineStart: playStartSec, timelineEnd: Infinity }];
  }
  const spans: TransportSpan[] = [];
  const firstLen = Math.max(0, loop.endSec - playStartSec);
  if (firstLen > 0 && fromUnfolded < firstLen) {
    spans.push({ unfoldedStart: 0, timelineStart: playStartSec, timelineEnd: loop.endSec });
  }
  const span = loop.endSec - loop.startSec;
  const firstPass = Math.max(0, Math.floor((fromUnfolded - firstLen) / span));
  for (let k = firstPass; ; k++) {
    const unfoldedStart = firstLen + k * span;
    if (unfoldedStart >= toUnfolded) break;
    if (unfoldedStart + span > fromUnfolded) {
      spans.push({ unfoldedStart, timelineStart: loop.startSec, timelineEnd: loop.endSec });
    }
  }
  return spans;
}

export interface ClipStart {
  segment: AudioSegment;
  /** Unfolded transport seconds at which the source starts. */
  unfoldedStart: number;
  /** Seconds into the segment where playback begins (0 = segment start). */
  segmentOffsetSec: number;
  /** How long this source plays. */
  durationSec: number;
}

/**
 * Source starts for the unfolded window [fromUnfolded, toUnfolded).
 * A clip "starts" where a segment begins inside a span, or where a span
 * begins inside a segment (seek into / loop back into the middle of audio).
 * With includeSounding, clips that started before the window but are still
 * playing at fromUnfolded are returned trimmed to start there (used to resume
 * audio after an edit or a late decode during playback).
 */
export function clipsInWindow(
  segments: readonly AudioSegment[],
  spans: readonly TransportSpan[],
  fromUnfolded: number,
  toUnfolded: number,
  includeSounding = false,
): ClipStart[] {
  const out: ClipStart[] = [];
  const eps = 1e-6;
  for (const span of spans) {
    for (const segment of segments) {
      const segEnd = segment.startSec + segment.durationSec;
      const tlStart = Math.max(segment.startSec, span.timelineStart);
      const tlEnd = Math.min(segEnd, span.timelineEnd);
      if (tlEnd - tlStart <= eps) continue;
      let unfoldedStart = span.unfoldedStart + (tlStart - span.timelineStart);
      let segOffset = tlStart - segment.startSec;
      let duration = tlEnd - tlStart;
      if (unfoldedStart < fromUnfolded - eps) {
        if (!includeSounding) continue;
        const skip = fromUnfolded - unfoldedStart;
        if (skip >= duration - eps) continue;
        unfoldedStart = fromUnfolded;
        segOffset += skip;
        duration -= skip;
      }
      if (unfoldedStart >= toUnfolded) continue;
      out.push({ segment, unfoldedStart, segmentOffsetSec: segOffset, durationSec: duration });
    }
  }
  return out.sort((a, b) => a.unfoldedStart - b.unfoldedStart);
}

export interface GainPoint {
  /** Seconds relative to the clip's start. */
  t: number;
  value: number;
}

/** Linear fade envelope of a segment at `t` seconds into it (0…gain). */
export function segmentEnvelopeAt(segment: AudioSegment, t: number): number {
  let v = segment.gain;
  if (segment.fadeInSec > 0 && t < segment.fadeInSec) {
    v *= Math.max(0, t) / segment.fadeInSec;
  }
  const untilEnd = segment.durationSec - t;
  if (segment.fadeOutSec > 0 && untilEnd < segment.fadeOutSec) {
    v *= Math.max(0, untilEnd) / segment.fadeOutSec;
  }
  return v;
}

/**
 * Gain automation for one clip (times relative to the clip start): the
 * segment's fades where they fall inside the clip, plus a de-click ramp in
 * and out where the clip cuts the segment mid-waveform.
 */
export function clipEnvelope(clip: ClipStart): GainPoint[] {
  const { segment, segmentOffsetSec: off, durationSec: dur } = clip;
  const points: GainPoint[] = [];
  const cutIn = off > 1e-6;
  const cutOut = off + dur < segment.durationSec - 1e-6;
  const at = (t: number): number => segmentEnvelopeAt(segment, off + t);

  points.push({ t: 0, value: cutIn ? 0 : at(0) });
  const inner: number[] = [];
  if (cutIn) inner.push(Math.min(DECLICK_SEC, dur / 2));
  const fadeInEnd = segment.fadeInSec - off;
  if (fadeInEnd > 0 && fadeInEnd < dur) inner.push(fadeInEnd);
  const fadeOutStart = segment.durationSec - segment.fadeOutSec - off;
  if (fadeOutStart > 0 && fadeOutStart < dur) inner.push(fadeOutStart);
  if (cutOut) inner.push(Math.max(0, dur - Math.min(DECLICK_SEC, dur / 2)));
  const sorted = [...new Set(inner.map((t) => Math.round(t * 1e7) / 1e7))].sort((a, b) => a - b);
  for (const t of sorted) {
    if (t <= 0 || t >= dur) continue;
    points.push({ t, value: at(t) });
  }
  points.push({ t: dur, value: cutOut ? 0 : at(dur) });
  return points;
}

// ── waveform peaks ───────────────────────────────────────────────────────────

/**
 * Absolute peak per bucket across all channels (0…1+), `buckets` long. Each
 * bucket covers an equal share of the frames; empty input → zeros.
 */
export function bucketPeaks(channels: readonly Float32Array[], buckets: number): Float32Array {
  const n = Math.max(0, Math.floor(buckets));
  const out = new Float32Array(n);
  const frames = channels.reduce((m, c) => Math.max(m, c.length), 0);
  if (n === 0 || frames === 0) return out;
  for (let b = 0; b < n; b++) {
    const from = Math.floor((b * frames) / n);
    const to = Math.max(from + 1, Math.floor(((b + 1) * frames) / n));
    let peak = 0;
    for (const data of channels) {
      const end = Math.min(to, data.length);
      for (let i = from; i < end; i++) {
        const v = Math.abs(data[i] ?? 0);
        if (v > peak) peak = v;
      }
    }
    out[b] = peak;
  }
  return out;
}

// ── metering ─────────────────────────────────────────────────────────────────

export const METER_FLOOR_DB = -96;

export function linearToDb(value: number): number {
  if (!(value > 0)) return METER_FLOOR_DB;
  return Math.max(METER_FLOOR_DB, 20 * Math.log10(value));
}

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/** Peak and RMS of a block of samples, in dBFS (floored at METER_FLOOR_DB). */
export function levelsOf(samples: Float32Array): { peakDb: number; rmsDb: number } {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] ?? 0;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  const rms = samples.length > 0 ? Math.sqrt(sum / samples.length) : 0;
  return { peakDb: linearToDb(peak), rmsDb: linearToDb(rms) };
}

// ── recording alignment ──────────────────────────────────────────────────────

/**
 * Frames to drop from the head of a capture so the take lines up with the
 * transport. The capture's first frame was recorded at context time
 * `captureStartTime`; the transport reached the take's start beat at `epoch`.
 * What the player hears at `epoch` leaves the speakers `outputLatency` later
 * and their sound reaches the capture `inputLatency` after that, so the
 * aligned frame is at epoch + compensationSec.
 */
export function recordingTrimFrames(
  captureStartTime: number,
  epoch: number,
  compensationSec: number,
  sampleRate: number,
): number {
  return Math.max(0, Math.round((epoch + compensationSec - captureStartTime) * sampleRate));
}
