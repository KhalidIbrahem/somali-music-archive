import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TranscriptionError,
  hzToMidi,
  noteNameToMidi,
  parseTranscription,
  transcriptionToRegion,
  transcriptionToTrack,
} from '../transcriptionImport';

const SESSION = path.resolve(__dirname, '../../../public/sample/session.json');

describe('transcription → MIDI region', () => {
  it('converts seconds to beats at the project tempo, confidence → velocity', () => {
    const t = parseTranscription({
      meta: { title: 'Take', bpm: 90 },
      notes: [
        { start: 1.5, end: 2, midi: 57, confidence: 0.4 },
        { start: 0, end: 0.5, midi: 60.2, confidence: 0.9, marked: true },
      ],
    });
    expect(t.unit).toBe('seconds');
    expect(t.bpm).toBe(90);
    expect(t.notes.map((n) => n.midi)).toEqual([60, 57]); // sorted, rounded

    const region = transcriptionToRegion(t, { bpm: 120, beatsPerBar: 4, startBeat: 8 });
    expect(region.kind).toBe('midi');
    expect(region.startBeat).toBe(8);
    expect(region.lengthBeats).toBe(4);
    expect(region.notes.map((n) => [n.startBeat, n.lengthBeats, n.midi, n.velocity])).toEqual([
      [0, 1, 60, 0.9],
      [3, 1, 57, 0.4],
    ]);

    const trimmed = transcriptionToRegion(t, {
      bpm: 120,
      beatsPerBar: 4,
      skipMarked: true,
      trimLeadingSilence: true,
    });
    expect(trimmed.notes.map((n) => [n.startBeat, n.midi])).toEqual([[0, 57]]);
  });

  it('keeps beat-based lists in beats and reads pitch names, Hz and MIDI-scaled velocity', () => {
    const t = parseTranscription([
      { startBeat: 2, lengthBeats: 0.5, pitch: 'A4', velocity: 64 },
      { startBeat: 0, lengthBeats: 1, hz: 220 },
      { startBeat: 1, lengthBeats: 0, midi: 50 }, // zero length: dropped
    ]);
    expect(t.unit).toBe('beats');
    const region = transcriptionToRegion(t, { bpm: 60, beatsPerBar: 3 });
    expect(region.notes.map((n) => [n.startBeat, n.lengthBeats, n.midi])).toEqual([
      [0, 1, 57],
      [2, 0.5, 69],
    ]);
    expect(region.notes[0]?.velocity).toBe(0.8); // default
    expect(region.notes[1]?.velocity).toBeCloseTo(64 / 127, 6);
    expect(region.lengthBeats).toBe(3);
  });

  it('helpers and errors', () => {
    expect(noteNameToMidi('C4')).toBe(60);
    expect(noteNameToMidi('C#3')).toBe(49);
    expect(noteNameToMidi('Bb2')).toBe(46);
    expect(noteNameToMidi('H2')).toBeNull();
    expect(hzToMidi(440)).toBe(69);
    expect(() => parseTranscription({ meta: {} })).toThrow(TranscriptionError);
    expect(() => parseTranscription({ notes: [{ foo: 1 }] })).toThrow(/no usable notes/);
  });

  it('imports the studio sample session (public/sample/session.json) whole', () => {
    const raw = JSON.parse(readFileSync(SESSION, 'utf8')) as {
      meta: { nNotes: number; durationSec: number; bpm: number };
      notes: { start: number; end: number; midi: number; confidence: number }[];
    };
    const t = parseTranscription(raw);
    expect(t.notes).toHaveLength(raw.meta.nNotes);
    const track = transcriptionToTrack(
      t,
      { bpm: 106, timeSignature: { beatsPerBar: 4, beatUnit: 4 } },
      'oud',
    );
    expect(track.instrument).toBe('oud');
    expect(track.name).toBe('Sample session');
    const region = track.regions[0];
    expect(region?.notes).toHaveLength(raw.meta.nNotes);
    const first = raw.notes[0];
    expect(region?.notes[0]?.startBeat).toBeCloseTo(((first?.start ?? 0) * 106) / 60, 9);
    expect(region?.notes[0]?.velocity).toBe(first?.confidence);
    // Every note fits in the region; the region is whole bars.
    const end = Math.max(...(region?.notes ?? []).map((n) => n.startBeat + n.lengthBeats));
    expect(region?.lengthBeats).toBeGreaterThanOrEqual(end);
    expect((region?.lengthBeats ?? 1) % 4).toBe(0);
  });
});
