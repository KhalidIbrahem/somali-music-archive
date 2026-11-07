import { describe, expect, it } from 'vitest';
import { GROOVE_PRESETS, type GroovePreset } from '@/lib/daw/grooves';
import { bpmFromTaps, expectedOnsets, scoreTaps } from '../tapTrainer';

const preset = (id: string): GroovePreset => {
  const found = GROOVE_PRESETS.find((groove) => groove.id === id);
  if (found === undefined) throw new Error(`no groove preset ${id}`);
  return found;
};

describe('expectedOnsets', () => {
  it('places the heello dum on steps 0 and 8: [0, 1.0] s at 120 BPM, 4/4, one bar', () => {
    expect(expectedOnsets(preset('heello'), 0, 120, 4, 1)).toEqual([0, 1]);
  });

  it('reads the tak lane and an empty slap lane', () => {
    expect(expectedOnsets(preset('heello'), 1, 120, 4, 1)).toEqual([0.5, 0.875, 1.5]);
    expect(expectedOnsets(preset('heello'), 2, 120, 4, 1)).toEqual([]);
  });

  it('repeats the pattern per bar and merges lanes for all', () => {
    const all = expectedOnsets(preset('heello'), 'all', 120, 4, 2);
    expect(all).toEqual([0, 0.5, 0.875, 1, 1.5, 2, 2.5, 2.875, 3, 3.5]);
    expect([...all].sort((a, b) => a - b)).toEqual(all);
  });

  it('counts a step shared by two lanes once', () => {
    const shared: GroovePreset = {
      id: 'test',
      label: 'Test',
      lanes: [
        [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
        [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      ],
    };
    expect(expectedOnsets(shared, 'all', 120, 4, 1)).toEqual([0, 0.5, 1]);
  });

  it('scales with tempo and metre', () => {
    const slow = expectedOnsets(preset('heello'), 0, 90, 4, 1);
    expect(slow[1]).toBeCloseTo(8 * (4 / 16) * (60 / 90), 6);
    const triple = expectedOnsets(preset('heello'), 0, 120, 3, 1);
    expect(triple).toEqual([0, 0.75]);
  });

  it('returns [] for no bars or no tempo', () => {
    expect(expectedOnsets(preset('heello'), 0, 120, 4, 0)).toEqual([]);
    expect(expectedOnsets(preset('heello'), 0, 0, 4, 1)).toEqual([]);
  });
});

describe('scoreTaps', () => {
  const beat = expectedOnsets(preset('heello'), 'all', 120, 4, 1); // [0, 0.5, 0.875, 1, 1.5]

  it('scores perfect taps 100 and steady', () => {
    const result = scoreTaps(beat, beat);
    expect(result.score).toBe(100);
    expect(result.bias).toBe('steady');
    expect(result.meanAbsErrorMs).toBe(0);
    expect(result.hits).toHaveLength(beat.length);
    expect(result.misses).toEqual([]);
    expect(result.extras).toEqual([]);
  });

  it('calls taps 40 ms late "late" and docks precision', () => {
    const result = scoreTaps(
      beat.map((t) => t + 0.04),
      beat,
    );
    expect(result.bias).toBe('late');
    expect(result.meanAbsErrorMs).toBeCloseTo(40, 6);
    expect(result.hits[0]?.errorMs).toBeCloseTo(40, 6);
    expect(result.score).toBe(88); // 70 · 1 · (1 − 40/240) + 30
  });

  it('calls taps 40 ms early "early" and small drift steady', () => {
    expect(
      scoreTaps(
        beat.map((t) => t - 0.04),
        beat,
      ).bias,
    ).toBe('early');
    expect(
      scoreTaps(
        beat.map((t) => t + 0.01),
        beat,
      ).bias,
    ).toBe('steady');
  });

  it('reports misses and extras and charges for them', () => {
    const expected = [0, 0.5, 1, 1.5];
    const result = scoreTaps([0, 0.5, 1.5, 3], expected);
    expect(result.hits.map((h) => h.expected)).toEqual([0, 0.5, 1.5]);
    expect(result.misses).toEqual([1]);
    expect(result.extras).toEqual([3]);
    expect(result.score).toBe(75); // 70 · 0.75 + 30 · 0.75
  });

  it('matches nearest first, one tap per onset', () => {
    const result = scoreTaps([0.3], [0, 0.5], 400);
    expect(result.hits.map((h) => h.expected)).toEqual([0.5]);
    expect(result.misses).toEqual([0]);

    const shared = scoreTaps([0.05], [0, 0.1]);
    expect(shared.hits).toHaveLength(1);
    expect(shared.misses).toHaveLength(1);
    expect(shared.extras).toEqual([]);
  });

  it('respects the tolerance', () => {
    expect(scoreTaps([0.13], [0]).hits).toHaveLength(0);
    expect(scoreTaps([0.13], [0], 150).hits).toHaveLength(1);
  });

  it('scores silence and an empty pattern 0', () => {
    expect(scoreTaps([], beat).score).toBe(0);
    expect(scoreTaps([], beat).misses).toEqual(beat);
    expect(scoreTaps(beat, []).score).toBe(0);
    expect(scoreTaps(beat, []).extras).toEqual(beat);
  });
});

describe('bpmFromTaps', () => {
  it('reads 120 BPM from taps every half second', () => {
    expect(bpmFromTaps([0, 0.5, 1, 1.5])).toBe(120);
  });

  it('needs at least three taps', () => {
    expect(bpmFromTaps([0, 0.5])).toBeNull();
    expect(bpmFromTaps([])).toBeNull();
    expect(bpmFromTaps([1, 1, 1])).toBeNull();
  });

  it('uses the median so a pause does not drag the tempo', () => {
    expect(bpmFromTaps([0, 0.5, 1, 1.5, 4, 4.5, 5])).toBe(120);
    expect(bpmFromTaps([1.5, 0, 1, 0.5])).toBe(120);
    expect(bpmFromTaps([0, 0.6667, 1.3333])).toBeCloseTo(90, 0);
  });
});
