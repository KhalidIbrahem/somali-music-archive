/**
 * The blind listening study (/study): who hears what, and the answer format.
 *
 * Each session draws `perComparison` pairs from every comparison in
 * stimuli.json (written by apps/ai-service/scripts/study_prepare.py), puts the
 * two clips of each pair on a random side, shuffles the trials, and adds one
 * attention check: the same clip on both sides, where the honest answer is
 * "the same". The page never knows which clip is the adapter; the clip ids
 * are opaque and the key lives in apps/ai-service/study/key.json.
 *
 * Pure: the random source is passed in, so sessions are testable.
 */

import { z } from 'zod';

export interface StimulusPair {
  pair: number;
  clips: [string, string];
}

export interface Comparison {
  id: string;
  pairs: StimulusPair[];
}

export interface Stimuli {
  version: number;
  comparisons: Comparison[];
}

export interface Trial {
  /** Position in the session, from 0. */
  index: number;
  comparison: string;
  pair: number;
  /** Clip ids as heard: left = A, right = B. */
  a: string;
  b: string;
  attention: boolean;
}

export type Rng = () => number;

/** Small seeded generator (mulberry32) for reproducible sessions in tests. */
export function seeded(seed: number): Rng {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function buildSession(stimuli: Stimuli, rng: Rng, perComparison = 4): Trial[] {
  const drawn: Omit<Trial, 'index'>[] = [];
  for (const c of stimuli.comparisons) {
    for (const p of shuffle(c.pairs, rng).slice(0, perComparison)) {
      const flip = rng() < 0.5;
      drawn.push({
        comparison: c.id,
        pair: p.pair,
        a: flip ? p.clips[1] : p.clips[0],
        b: flip ? p.clips[0] : p.clips[1],
        attention: false,
      });
    }
  }
  const trials = shuffle(drawn, rng);
  // The attention check: a clip against itself, never first or last.
  const source = trials[Math.floor(rng() * trials.length)];
  if (source) {
    const at = 1 + Math.floor(rng() * Math.max(1, trials.length - 1));
    trials.splice(at, 0, { ...source, b: source.a, attention: true });
  }
  return trials.map((t, index) => ({ ...t, index }));
}

export const PREFERENCES = ['a', 'b', 'same', 'neither'] as const;
export const QUALITY = ['a', 'b', 'same'] as const;
export const BACKGROUNDS = [
  'somali_performer_pro',
  'somali_performer',
  'somali_listener',
  'other_musician',
  'other',
] as const;
export const PLAYBACK = ['headphones', 'speakers', 'phone_speaker'] as const;

const clipId = z.string().regex(/^[0-9a-f]{12}$/);

export const answerSchema = z.object({
  index: z.number().int().min(0).max(99),
  comparison: z.string().regex(/^[a-z0-9_]{1,24}$/),
  pair: z.number().int().min(0).max(999),
  a: clipId,
  b: clipId,
  attention: z.boolean(),
  /** Which sounds more like Somali music (qaraami / heello). */
  somali: z.enum(PREFERENCES),
  /** Which sounds better as a recording. */
  quality: z.enum(QUALITY),
  /** Seconds each side was played. */
  playedA: z.number().min(0).max(3600),
  playedB: z.number().min(0).max(3600),
  ms: z.number().int().min(0).max(3_600_000),
});

export const responseSchema = z.object({
  study: z.literal('qaraamigen-listening-v1'),
  session: z.string().regex(/^[0-9a-z]{8,32}$/),
  lang: z.enum(['en', 'so']),
  consent: z.literal(true),
  background: z.enum(BACKGROUNDS),
  instrument: z.string().trim().max(80).default(''),
  years: z.number().int().min(0).max(90).nullable(),
  familiarity: z.number().int().min(1).max(5),
  playback: z.enum(PLAYBACK),
  answers: z.array(answerSchema).min(1).max(40),
  comment: z.string().trim().max(2000).default(''),
  /** Honeypot: a hidden field people never fill. */
  website: z.string().max(0).optional(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
});

export type StudyAnswer = z.infer<typeof answerSchema>;
export type StudyResponse = z.infer<typeof responseSchema>;

/** Random session id, lowercase base-36. */
export function sessionId(rng: Rng = Math.random): string {
  let s = '';
  for (let i = 0; i < 16; i++) s += Math.floor(rng() * 36).toString(36);
  return s;
}
