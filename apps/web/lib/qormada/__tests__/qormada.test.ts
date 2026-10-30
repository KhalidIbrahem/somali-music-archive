import { describe, expect, it } from 'vitest';
import type { MeasuredNote, PitchFrame } from '@/lib/daw/pitch';
import { analyseMelody, fixOctaveJumps, highpass, onsetEnvelope } from '../melody';
import { keyFifths, spell, toMusicXml } from '../musicxml';
import { splitRepeatedNotes } from '../onsets';
import { decompose, quantize, type TimedNote } from '../quantize';
import { buildSheet, melodyNotes } from '../sheet';
import { estimateTempo, estimateTempoFromEnvelope } from '../tempo';

const RATE = 44100;

/** Plucked tone: harmonic partials with an exponential decay (oud-like). */
function pluck(midi: number, sec: number): Float32Array {
  const hz = 440 * Math.pow(2, (midi - 69) / 12);
  const n = Math.round(sec * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const env = Math.min(1, i / 60) * Math.exp(-t * 3);
    out[i] =
      0.4 *
      env *
      (Math.sin(2 * Math.PI * hz * t) +
        0.4 * Math.sin(4 * Math.PI * hz * t) +
        0.2 * Math.sin(6 * Math.PI * hz * t));
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

const note = (start: number, end: number, midi: number, offScale = false): TimedNote => ({
  start,
  end,
  midi,
  deviationCents: 0,
  offScale,
  confidence: 0.9,
});

describe('tempo', () => {
  it('recovers the tempo of jittered eighth-note onsets', () => {
    const beat = 60 / 96;
    const onsets = Array.from(
      { length: 48 },
      (_, i) => 0.31 + (i * beat) / 2 + (((i * 7) % 5) - 2) * 0.004,
    );
    const est = estimateTempo(onsets);
    expect(est).not.toBeNull();
    expect(Math.abs(est!.bpm - 96)).toBeLessThanOrEqual(1);
    expect(est!.confidence).toBeGreaterThan(0.9);
  });

  it('needs at least four onsets', () => {
    expect(estimateTempo([0, 0.5, 1])).toBeNull();
  });
});

describe('rhythm', () => {
  it('keeps values inside the beat and starts long values on a beat', () => {
    expect(decompose(0, 16)).toEqual([16]);
    expect(decompose(1, 3)).toEqual([3]);
    expect(decompose(2, 4)).toEqual([2, 2]);
    expect(decompose(4, 12)).toEqual([4, 8]);
    expect(decompose(0, 8)).toEqual([8]);
    expect(decompose(0, 6)).toEqual([6]);
    expect(decompose(3, 6)).toEqual([1, 4, 1]);
    expect(decompose(4, 8, 4, { rest: true })).toEqual([4, 4]);
    expect(decompose(0, 12, 4, { beatsPerBar: 3, rest: true })).toEqual([8, 4]);
  });

  it('quantizes, fills rests and ties across the barline', () => {
    const beat = 0.5; // 120 BPM
    const q = quantize(
      [note(0, beat, 60), note(beat, 2 * beat, 62), note(3 * beat, 5 * beat, 64)],
      { bpm: 120, phaseSec: 0, beatsPerBar: 4 },
    );
    expect(q.measures).toHaveLength(2);
    const [m1, m2] = q.measures;
    expect(m1!.map((e) => [e.midi, e.units])).toEqual([
      [60, 4],
      [62, 4],
      [null, 4],
      [64, 4],
    ]);
    expect(m1![3]!.tieStart).toBe(true);
    expect(m2![0]).toMatchObject({ midi: 64, units: 4, tieStop: true });
    expect(m2!.slice(1).map((e) => e.midi)).toEqual([null, null]);
  });

  it('joins gaps shorter than a beat when legato is on', () => {
    const notes = [note(0, 0.1, 60), note(0.5, 0.6, 62), note(2, 2.1, 64)];
    const opts = { bpm: 120, phaseSec: 0, beatsPerBar: 4 };
    const plain = quantize(notes, opts).measures[0]!;
    const legato = quantize(notes, { ...opts, fillGaps: 3 }).measures[0]!;
    expect(plain.filter((e) => e.midi === null).length).toBeGreaterThan(2);
    // 60 fills its beat; 62 stays short (the next gap is three beats); rests remain.
    expect(legato[0]).toMatchObject({ midi: 60, units: 4 });
    expect(legato[1]).toMatchObject({ midi: 62, units: 1 });
  });

  it('keeps one note per grid step', () => {
    const q = quantize([note(0, 0.5, 60), note(0.01, 1.0, 62)], {
      bpm: 120,
      phaseSec: 0,
      beatsPerBar: 4,
    });
    expect(q.dropped).toBe(1);
    expect(q.measures[0]![0]!.midi).toBe(62);
  });
});

describe('notation', () => {
  it('picks the nearest key holding the pentatonic set', () => {
    expect(keyFifths([4, 7, 9, 11, 2])).toBe(0); // E minor pentatonic
    expect(keyFifths([6, 8, 10, 1, 3])).toBe(5); // F# major pentatonic → B major
    expect(keyFifths([10, 0, 2, 5, 7])).toBe(-1); // Bb major pentatonic → F major
  });

  it('spells notes from the key', () => {
    expect(spell(66, 1)).toEqual({ step: 'F', alter: 1, octave: 4 });
    expect(spell(70, -1)).toEqual({ step: 'B', alter: -1, octave: 4 });
    expect(spell(61, 0)).toEqual({ step: 'C', alter: 1, octave: 4 });
  });

  it('writes cents marks, red off-scale notes and accidentals once per bar', () => {
    const q = quantize(
      [
        { ...note(0, 0.5, 61, true), deviationCents: -32 },
        note(0.5, 1, 61, true),
        { ...note(1, 1.5, 64), deviationCents: 8 },
      ],
      { bpm: 120, phaseSec: 0, beatsPerBar: 4 },
    );
    const xml = toMusicXml(q, {
      title: 'Test <tune>',
      bpm: 120,
      scalePitchClasses: [4, 7, 9, 11, 2],
      caption: 'E minor pentatonic',
      showCents: true,
    });
    expect(xml).toContain('<work-title>Test &lt;tune&gt;</work-title>');
    expect(xml.match(/<accidental>sharp<\/accidental>/g)).toHaveLength(1);
    expect(xml).toContain('<text>−32</text>');
    expect(xml).not.toContain('<text>+8</text>');
    expect(xml.match(/color="#B3261E"/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('melody mode', () => {
  const measured = (midi: number, i: number): MeasuredNote => ({
    start: i * 0.3,
    end: i * 0.3 + 0.25,
    midi,
    deviationCents: 0,
    confidence: 0.9,
    offScale: false,
    db: -20,
  });

  it('moves a lone octave slip back to its neighbours', () => {
    const line = [64, 62, 60, 50, 62, 64, 67].map(measured);
    const { notes, fixes } = fixOctaveJumps(line);
    expect(fixes).toBe(1);
    expect(notes.map((n) => n.midi)).toEqual([64, 62, 60, 62, 62, 64, 67]);
  });

  it('leaves a real leap alone when the octave move does not bring it closer', () => {
    const { fixes } = fixOctaveJumps([60, 62, 64, 69, 71, 72, 74].map(measured));
    expect(fixes).toBe(0);
  });

  it('high-pass removes the bass and keeps the melody', () => {
    const n = RATE;
    const bass = Float32Array.from({ length: n }, (_, i) =>
      Math.sin((2 * Math.PI * 55 * i) / RATE),
    );
    const tune = Float32Array.from({ length: n }, (_, i) =>
      Math.sin((2 * Math.PI * 440 * i) / RATE),
    );
    const rms = (x: Float32Array): number =>
      Math.sqrt(x.slice(RATE / 4).reduce((s, v) => s + v * v, 0) / (x.length - RATE / 4));
    const twice = (x: Float32Array): Float32Array => highpass(highpass(x, RATE, 150), RATE, 150);
    expect(rms(twice(bass))).toBeLessThan(0.03 * rms(bass));
    expect(rms(twice(tune))).toBeGreaterThan(0.9 * rms(tune));
  });

  it('finds the tempo of a drum pattern from the onset envelope', () => {
    const beat = 60 / 110;
    const audio = new Float32Array(Math.round(12 * RATE));
    for (let k = 0; k * beat < 11.8; k++) {
      const at = Math.round((0.2 + k * beat) * RATE);
      for (let i = 0; i < 2000; i++) audio[at + i] = Math.sin(i * 0.3) * Math.exp(-i / 300);
    }
    const est = estimateTempoFromEnvelope(onsetEnvelope(audio, RATE), 0.01);
    expect(est).not.toBeNull();
    expect(Math.abs(est!.bpm - 110)).toBeLessThanOrEqual(1);
    expect(Math.abs(((est!.phaseSec - 0.2 + beat) % beat) - 0)).toBeLessThan(0.03);
  });
});

describe('repeated plucks', () => {
  it('splits a held pitch where the level jumps again', () => {
    const frames: PitchFrame[] = [];
    for (let i = 0; i < 60; i++) {
      const t = i * 0.01;
      const db = i < 30 ? -10 - i : -10 - (i - 30); // decay, re-pluck at 0.30 s
      frames.push({ t, hz: 220, clarity: 0.95, db });
    }
    const held: MeasuredNote = {
      start: 0,
      end: 0.6,
      midi: 57,
      deviationCents: 0,
      confidence: 0.95,
      offScale: false,
      db: -20,
    };
    const parts = splitRepeatedNotes([held], frames);
    expect(parts).toHaveLength(2);
    expect(parts[0]!.end).toBeCloseTo(0.3, 2);
  });
});

describe('audio to sheet music', () => {
  it('transcribes a plucked pentatonic melody and Verovio engraves it', async () => {
    // A minor pentatonic at 100 BPM, eighth and quarter notes, repeated A plucks.
    const e = 0.3;
    const melody: Array<[number, number]> = [
      [57, e],
      [57, e],
      [60, e],
      [62, e],
      [64, 2 * e],
      [67, e],
      [64, e],
      [62, e],
      [60, e],
      [57, 2 * e],
      [57, e],
      [60, e],
      [62, 2 * e],
      [57, 4 * e],
    ];
    const audio = concat(melody.map(([m, d]) => pluck(m, d)));
    const analysis = await analyseMelody([audio], RATE, {
      startSec: 0,
      endSec: audio.length / RATE,
    });
    const notes = melodyNotes(analysis);
    expect(analysis.fit?.tonic).toBe(9);
    expect(notes.length).toBeGreaterThanOrEqual(melody.length - 2);

    const sheet = buildSheet(analysis, notes, {
      title: 'Test melody',
      bpm: null,
      beatsPerBar: 4,
      transpose: 0,
      showCents: true,
      includeOffScale: true,
      legato: true,
    });
    expect(Math.abs(sheet.bpm - 100)).toBeLessThanOrEqual(3);
    expect(sheet.scaleName).toBe('A minor pentatonic');

    const [{ default: createVerovioModule }, { VerovioToolkit }] = await Promise.all([
      import('verovio/wasm'),
      import('verovio/esm'),
    ]);
    const toolkit = new VerovioToolkit(await createVerovioModule());
    expect(toolkit.loadData(sheet.xml)).toBeTruthy();
    expect(toolkit.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(toolkit.renderToSVG(1)).toContain('<svg');
    expect(toolkit.renderToMIDI().length).toBeGreaterThan(100);
  }, 60_000);
});
