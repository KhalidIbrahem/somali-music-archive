import { describe, expect, it } from 'vitest';
import {
  bucketPeaks,
  clampFades,
  clipEnvelope,
  clipsInWindow,
  DECLICK_SEC,
  levelsOf,
  linearToDb,
  METER_FLOOR_DB,
  recordingTrimFrames,
  regionSegments,
  segmentEnvelopeAt,
  transportSpans,
  type AudioSegment,
} from '../audioSchedule';
import { newAudioRegion, type DawAudioRegion } from '../types';

// 120 BPM → 0.5 s per beat keeps the arithmetic readable.
const SPB = 0.5;

function region(over: Partial<DawAudioRegion> = {}): DawAudioRegion {
  return { ...newAudioRegion('/demo.mp3', 'clip', 4, 8), fadeInSec: 0, fadeOutSec: 0, ...over };
}

describe('regionSegments', () => {
  it('maps beats to seconds and plays the file from offsetSec', () => {
    const [seg, ...rest] = regionSegments(region({ offsetSec: 1.5 }), SPB, 30);
    expect(rest).toHaveLength(0);
    expect(seg).toMatchObject({ startSec: 2, durationSec: 4, fileOffsetSec: 1.5 });
  });

  it('repeats the same file window once per loop pass', () => {
    const segs = regionSegments(region({ loopCount: 3, offsetSec: 2 }), SPB, 30);
    expect(segs.map((s) => s.startSec)).toEqual([2, 6, 10]);
    expect(segs.every((s) => s.fileOffsetSec === 2 && s.durationSec === 4)).toBe(true);
  });

  it('applies region fades at the outer edges and de-clicks inner joins', () => {
    const segs = regionSegments(region({ loopCount: 3, fadeInSec: 0.5, fadeOutSec: 1 }), SPB, 30);
    expect(segs.map((s) => [s.fadeInSec, s.fadeOutSec])).toEqual([
      [0.5, DECLICK_SEC],
      [DECLICK_SEC, DECLICK_SEC],
      [DECLICK_SEC, 1],
    ]);
  });

  it('stops at the end of a short file (silence for the rest of the pass)', () => {
    const [seg] = regionSegments(region({ offsetSec: 1 }), SPB, 3);
    expect(seg?.durationSec).toBe(2);
  });

  it('is empty when the offset is past the end of the file', () => {
    expect(regionSegments(region({ offsetSec: 5 }), SPB, 3)).toEqual([]);
  });

  it('clamps overlapping fades proportionally', () => {
    expect(clampFades(3, 1, 2)).toEqual([1.5, 0.5]);
    expect(clampFades(0.1, 0.2, 2)).toEqual([0.1, 0.2]);
  });
});

describe('transportSpans', () => {
  it('is one open span without a loop', () => {
    expect(transportSpans(3, null, 0, 1)).toEqual([
      { unfoldedStart: 0, timelineStart: 3, timelineEnd: Infinity },
    ]);
  });

  it('plays from the start position to the loop end, then the loop range', () => {
    const loop = { startSec: 2, endSec: 6 };
    expect(transportSpans(3, loop, 0, 12)).toEqual([
      { unfoldedStart: 0, timelineStart: 3, timelineEnd: 6 },
      { unfoldedStart: 3, timelineStart: 2, timelineEnd: 6 },
      { unfoldedStart: 7, timelineStart: 2, timelineEnd: 6 },
      { unfoldedStart: 11, timelineStart: 2, timelineEnd: 6 },
    ]);
  });

  it('returns only the spans overlapping the window', () => {
    const loop = { startSec: 2, endSec: 6 };
    expect(transportSpans(3, loop, 7.5, 7.65).map((s) => s.unfoldedStart)).toEqual([7]);
  });
});

describe('clipsInWindow', () => {
  const seg: AudioSegment = {
    regionId: 'r',
    source: 's',
    startSec: 2,
    durationSec: 4,
    fileOffsetSec: 1,
    gain: 1,
    fadeInSec: 0,
    fadeOutSec: 0,
  };

  it('starts a segment at its timeline position relative to play start', () => {
    const spans = transportSpans(0, null, 0, 10);
    expect(clipsInWindow([seg], spans, 1.9, 2.05)).toEqual([
      { segment: seg, unfoldedStart: 2, segmentOffsetSec: 0, durationSec: 4 },
    ]);
    expect(clipsInWindow([seg], spans, 2.05, 2.2)).toEqual([]);
  });

  it('plays from the middle of a region when the transport starts inside it', () => {
    const spans = transportSpans(3.5, null, -0.001, 0.15);
    const [clip] = clipsInWindow([seg], spans, -0.001, 0.15);
    expect(clip).toMatchObject({ unfoldedStart: 0, segmentOffsetSec: 1.5, durationSec: 2.5 });
  });

  it('re-enters the segment mid-file on each loop wrap and cuts at the loop end', () => {
    const loop = { startSec: 3, endSec: 5 };
    const spans = transportSpans(4, loop, 0, 6);
    const clips = clipsInWindow([seg], spans, -0.001, 6);
    expect(clips.map((c) => [c.unfoldedStart, c.segmentOffsetSec, c.durationSec])).toEqual([
      [0, 2, 1],
      [1, 1, 2],
      [3, 1, 2],
      [5, 1, 2],
    ]);
  });

  it('with includeSounding resumes a clip already playing, trimmed to the window', () => {
    const spans = transportSpans(0, null, 3, 4);
    expect(clipsInWindow([seg], spans, 3, 4)).toEqual([]);
    const [clip] = clipsInWindow([seg], spans, 3, 4, true);
    expect(clip).toMatchObject({ unfoldedStart: 3, segmentOffsetSec: 1, durationSec: 3 });
  });
});

describe('clip envelopes', () => {
  const seg: AudioSegment = {
    regionId: 'r',
    source: 's',
    startSec: 0,
    durationSec: 4,
    fileOffsetSec: 0,
    gain: 0.8,
    fadeInSec: 1,
    fadeOutSec: 2,
  };

  it('evaluates linear fades', () => {
    expect(segmentEnvelopeAt(seg, 0)).toBe(0);
    expect(segmentEnvelopeAt(seg, 0.5)).toBeCloseTo(0.4);
    expect(segmentEnvelopeAt(seg, 1.5)).toBeCloseTo(0.8);
    expect(segmentEnvelopeAt(seg, 3)).toBeCloseTo(0.4);
    expect(segmentEnvelopeAt(seg, 4)).toBe(0);
  });

  it('builds breakpoints for a whole segment', () => {
    const points = clipEnvelope({
      segment: seg,
      unfoldedStart: 0,
      segmentOffsetSec: 0,
      durationSec: 4,
    });
    expect(points.map((p) => p.t)).toEqual([0, 1, 2, 4]);
    expect(points.map((p) => Number(p.value.toFixed(3)))).toEqual([0, 0.8, 0.8, 0]);
  });

  it('de-clicks a clip cut mid-segment on both sides', () => {
    const flat = { ...seg, fadeInSec: 0, fadeOutSec: 0 };
    const points = clipEnvelope({
      segment: flat,
      unfoldedStart: 0,
      segmentOffsetSec: 1,
      durationSec: 2,
    });
    expect(points[0]).toEqual({ t: 0, value: 0 });
    expect(points[1]).toEqual({ t: DECLICK_SEC, value: 0.8 });
    expect(points.at(-1)).toEqual({ t: 2, value: 0 });
  });
});

describe('bucketPeaks', () => {
  it('takes the absolute peak per bucket across channels', () => {
    const left = new Float32Array([0.1, -0.5, 0.2, 0.0, 0.3, -0.1]);
    const right = new Float32Array([0.0, 0.2, -0.9, 0.1, 0.0, 0.05]);
    expect(Array.from(bucketPeaks([left, right], 3)).map((v) => Number(v.toFixed(3)))).toEqual([
      0.5, 0.9, 0.3,
    ]);
  });

  it('handles more buckets than frames and empty input', () => {
    expect(bucketPeaks([new Float32Array([0.5, -1])], 4)).toHaveLength(4);
    expect(Array.from(bucketPeaks([], 3))).toEqual([0, 0, 0]);
    expect(bucketPeaks([new Float32Array(10)], 0)).toHaveLength(0);
  });
});

describe('levels', () => {
  it('reports peak and RMS in dBFS', () => {
    const square = new Float32Array(64).map((_, i) => (i % 2 ? 0.5 : -0.5));
    const { peakDb, rmsDb } = levelsOf(square);
    expect(peakDb).toBeCloseTo(-6.02, 1);
    expect(rmsDb).toBeCloseTo(-6.02, 1);
  });

  it('floors silence', () => {
    expect(levelsOf(new Float32Array(16))).toEqual({
      peakDb: METER_FLOOR_DB,
      rmsDb: METER_FLOOR_DB,
    });
    expect(linearToDb(1)).toBe(0);
  });
});

describe('recordingTrimFrames', () => {
  it('drops the pre-roll plus the round-trip latency', () => {
    // Capture started 1 s before the downbeat; 20 ms total latency at 48 kHz.
    expect(recordingTrimFrames(10, 11, 0.02, 48000)).toBe(48960);
  });

  it('never trims a negative amount', () => {
    expect(recordingTrimFrames(12, 11, 0.02, 48000)).toBe(0);
  });
});
