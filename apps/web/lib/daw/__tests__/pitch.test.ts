import { describe, expect, it } from 'vitest';
import {
  analysePitch,
  downmix,
  fitPentatonic,
  hzToCents,
  segmentNotes,
  trackPitch,
  tuningOffset,
  type PitchFrame,
} from '../pitch';

const RATE = 44100;

/** Harmonic tone (3 partials) at midi + cents, `sec` long, with 5 ms ramps. */
function tone(midi: number, cents: number, sec: number): Float32Array {
  const hz = 440 * Math.pow(2, (midi - 69 + cents / 100) / 12);
  const n = Math.round(sec * RATE);
  const out = new Float32Array(n);
  const ramp = Math.round(0.005 * RATE);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const env = Math.min(1, i / ramp, (n - i) / ramp);
    out[i] =
      (0.5 *
        env *
        (Math.sin(2 * Math.PI * hz * t) +
          0.5 * Math.sin(4 * Math.PI * hz * t) +
          0.25 * Math.sin(6 * Math.PI * hz * t))) /
      1.75;
  }
  return out;
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A minor pentatonic phrase (A C D E G), the tonic A sounded most, +25 c "cassette" offset. */
function phrase(extra: number[] = []): Float32Array {
  const melody = [57, 60, 62, 57, 64, 67, 64, 62, 60, 57, 57, ...extra];
  return concat(
    melody.flatMap((m) => [tone(m, 25, 0.3), new Float32Array(Math.round(0.04 * RATE))]),
  );
}

describe('pitch lens', () => {
  it('downmixes to ~11 kHz and keeps the requested span', () => {
    const left = tone(69, 0, 1);
    const { samples, rate } = downmix([left, left], RATE, 0.25, 0.75);
    expect(rate).toBeCloseTo(11025, 0);
    expect(samples.length).toBeCloseTo(0.5 * rate, -1);
  });

  it('tracks a steady tone to within a few cents', async () => {
    const { samples, rate } = downmix([tone(57, 0, 0.6)], RATE);
    const frames = await trackPitch(samples, rate);
    const voiced = frames.filter((f) => f.hz !== null);
    expect(voiced.length).toBeGreaterThan(30);
    const median = voiced.map((f) => hzToCents(f.hz!)).sort((a, b) => a - b)[
      Math.floor(voiced.length / 2)
    ]!;
    expect(Math.abs(median - -1200)).toBeLessThan(5); // A3 = −1200 c from A4
  });

  it('gates silence as unvoiced', async () => {
    const frames = await trackPitch(new Float32Array(11025), 11025);
    expect(frames.every((f) => f.hz === null)).toBe(true);
  });

  it('recovers the tuning offset, tonic, mode and on-grid share without snapping', async () => {
    const result = await analysePitch([phrase()], RATE, { startSec: 0, endSec: 10 });
    expect(Math.abs(result.offsetCents - 25)).toBeLessThan(6);
    expect(result.fit).not.toBeNull();
    expect(result.fit!.tonic).toBe(9); // A
    expect(result.fit!.mode).toBe('minor-pentatonic');
    expect(result.fit!.withinQuarterTone).toBeGreaterThan(0.9);
    expect(result.notes.length).toBeGreaterThanOrEqual(9);
    expect(result.notes.every((n) => Math.abs(n.deviationCents) < 15)).toBe(true);
    expect(result.notes[0]!.midi).toBe(57);
  });

  it('marks an off-scale note instead of correcting it', async () => {
    const result = await analysePitch([phrase([65, 65])], RATE, { startSec: 0, endSec: 10 }); // F
    const f = result.notes.filter((n) => n.midi === 65);
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((n) => n.offScale)).toBe(true);
  });

  it('keeps a degree placed off its 12-TET template as a measured deviation', () => {
    // Synthetic frames: A, C, E, G on template, D sung 40 c flat — offset 0.
    const at = (midi: number, cents: number): number =>
      440 * Math.pow(2, (midi - 69 + cents / 100) / 12);
    const frames: PitchFrame[] = [];
    let t = 0;
    for (const [m, c, n] of [
      [57, 0, 60],
      [60, 0, 30],
      [62, -40, 30],
      [64, 0, 30],
      [67, 0, 30],
    ] as const) {
      for (let i = 0; i < n; i++)
        frames.push({ t: (t += 0.01), hz: at(m, c), clarity: 0.95, db: -20 });
    }
    const offset = tuningOffset(frames);
    expect(Math.abs(offset)).toBeLessThan(10);
    const fit = fitPentatonic(frames, offset)!;
    const d = fit.profile.find((p) => p.template === 5)!; // D is 5 semitones above A
    expect(d.deviationCents).not.toBeNull();
    expect(d.deviationCents! + offset).toBeLessThan(-30);
    const notes = segmentNotes(frames, offset, fit);
    expect(notes.find((n) => n.midi === 62)!.deviationCents).toBeLessThan(-30);
  });

  it('honours cancellation', async () => {
    const { samples, rate } = downmix([phrase()], RATE);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(trackPitch(samples, rate, { signal: ctrl.signal })).rejects.toThrow('cancelled');
  });
});
