import { describe, expect, it } from 'vitest';
import stimuli from '../stimuli.json';
import { buildSession, responseSchema, seeded, sessionId, type Stimuli } from '../design';
import { STRINGS } from '../strings';

const S = stimuli as unknown as Stimuli;

describe('listening study design', () => {
  it('draws four pairs per comparison plus one attention check', () => {
    const trials = buildSession(S, seeded(1));
    expect(trials).toHaveLength(S.comparisons.length * 4 + 1);
    for (const c of S.comparisons) {
      expect(trials.filter((t) => t.comparison === c.id && !t.attention)).toHaveLength(4);
    }
    const checks = trials.filter((t) => t.attention);
    expect(checks).toHaveLength(1);
    expect(checks[0]!.a).toBe(checks[0]!.b);
    expect(checks[0]!.index).toBeGreaterThan(0);
    expect(trials.map((t) => t.index)).toEqual(trials.map((_, i) => i));
  });

  it('never repeats a pair and keeps each pair to its own two clips', () => {
    const trials = buildSession(S, seeded(7)).filter((t) => !t.attention);
    const keys = trials.map((t) => `${t.comparison}/${t.pair}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of trials) {
      const pair = S.comparisons
        .find((c) => c.id === t.comparison)!
        .pairs.find((p) => p.pair === t.pair)!;
      expect([t.a, t.b].sort()).toEqual([...pair.clips].sort());
    }
  });

  it('puts each clip on the left about half the time over many sessions', () => {
    let left = 0;
    let total = 0;
    for (let s = 0; s < 400; s++) {
      for (const t of buildSession(S, seeded(s)).filter((x) => !x.attention)) {
        const pair = S.comparisons
          .find((c) => c.id === t.comparison)!
          .pairs.find((p) => p.pair === t.pair)!;
        total++;
        if (t.a === pair.clips[0]) left++;
      }
    }
    expect(left / total).toBeGreaterThan(0.45);
    expect(left / total).toBeLessThan(0.55);
  });

  it('validates a complete response and rejects a filled honeypot or a bad clip id', () => {
    const trials = buildSession(S, seeded(3));
    const ok = {
      study: 'qaraamigen-listening-v1',
      session: sessionId(seeded(9)),
      lang: 'so',
      consent: true,
      background: 'somali_performer',
      instrument: 'kaban',
      years: 12,
      familiarity: 5,
      playback: 'headphones',
      answers: trials.map((t) => ({
        ...t,
        somali: 'a',
        quality: 'same',
        playedA: 8,
        playedB: 6.5,
        ms: 21000,
      })),
      comment: '',
      startedAt: '2026-11-01T10:00:00.000Z',
      finishedAt: '2026-11-01T10:11:00.000Z',
    };
    expect(responseSchema.safeParse(ok).success).toBe(true);
    expect(responseSchema.safeParse({ ...ok, website: 'spam' }).success).toBe(false);
    expect(responseSchema.safeParse({ ...ok, consent: false }).success).toBe(false);
    const bad = { ...ok, answers: [{ ...ok.answers[0]!, a: '../../etc' }] };
    expect(responseSchema.safeParse(bad).success).toBe(false);
  });

  it('has every text in both languages', () => {
    const en = Object.keys(STRINGS.en).sort();
    expect(Object.keys(STRINGS.so).sort()).toEqual(en);
    expect(Object.keys(STRINGS.so.backgrounds).sort()).toEqual(
      Object.keys(STRINGS.en.backgrounds).sort(),
    );
  });
});
