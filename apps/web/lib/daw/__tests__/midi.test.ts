import { describe, expect, it } from 'vitest';
import {
  MidiParseError,
  encodeMidi,
  midiToDawTracks,
  parseMidi,
  projectToMidi,
  projectToMidiSong,
  type MidiSong,
} from '../midi';
import { newAudioTrack, newProject, newRegion } from '../types';

const SONG: MidiSong = {
  bpm: 96,
  timeSignature: { beatsPerBar: 3, beatUnit: 4 },
  tracks: [
    {
      name: 'Oud',
      channel: 0,
      notes: [
        { startBeat: 0, lengthBeats: 0.5, midi: 57, velocity: 100 / 127 },
        { startBeat: 0.5, lengthBeats: 0.25, midi: 60, velocity: 64 / 127 },
        // Same key re-struck right as the previous one ends.
        { startBeat: 0.75, lengthBeats: 1, midi: 60, velocity: 1 },
        { startBeat: 2, lengthBeats: 1.5, midi: 64, velocity: 30 / 127 },
      ],
    },
    {
      name: 'Durbaan',
      channel: 9,
      notes: [
        { startBeat: 0, lengthBeats: 0.25, midi: 36, velocity: 110 / 127 },
        { startBeat: 1, lengthBeats: 0.25, midi: 38, velocity: 90 / 127 },
      ],
    },
  ],
};

describe('Standard MIDI File round trip', () => {
  it('decode(encode(song)) equals the song', () => {
    const parsed = parseMidi(encodeMidi({ ...SONG, name: 'Test' }));
    expect(parsed.format).toBe(1);
    expect(parsed.ppq).toBe(480);
    expect(parsed.hasTempo).toBe(true);
    expect(parsed.bpm).toBeCloseTo(96, 3);
    expect(parsed.timeSignature).toEqual({ beatsPerBar: 3, beatUnit: 4 });
    expect(parsed.tracks).toHaveLength(2);
    parsed.tracks.forEach((track, i) => {
      const expected = SONG.tracks[i];
      expect(track.name).toBe(expected?.name);
      expect(track.channel).toBe(expected?.channel);
      expect(track.notes).toHaveLength(expected?.notes.length ?? -1);
      track.notes.forEach((note, j) => {
        const want = expected?.notes[j];
        expect(note.startBeat).toBeCloseTo(want?.startBeat ?? NaN, 6);
        expect(note.lengthBeats).toBeCloseTo(want?.lengthBeats ?? NaN, 6);
        expect(note.midi).toBe(want?.midi);
        expect(note.velocity).toBeCloseTo(want?.velocity ?? NaN, 6);
      });
    });
  });

  it('encode is stable across a second round trip (byte-identical)', () => {
    const once = encodeMidi({ ...SONG, name: 'Test' });
    const parsed = parseMidi(once);
    const twice = encodeMidi({ ...parsed, name: 'Test' });
    expect([...twice]).toEqual([...once]);
  });

  it('exports a project: one MTrk per MIDI track, loops unrolled, audio tracks skipped', () => {
    const project = newProject('Round trip');
    project.bpm = 110;
    const oud = project.tracks[0];
    if (!oud) throw new Error('fixture');
    const region = newRegion(4, 2);
    region.loopCount = 2;
    region.notes = [
      { id: 'a', startBeat: 0, lengthBeats: 1, midi: 69, velocity: 0.5 },
      { id: 'b', startBeat: 3, lengthBeats: 1, midi: 70, velocity: 0.5 }, // past region end: not played
    ];
    oud.regions = [region];
    project.tracks.push(newAudioTrack('Loop'));

    const song = projectToMidiSong(project);
    expect(song.tracks.map((t) => t.name)).toEqual(['Oud', 'Durbaan', 'Bass', 'Keys']);
    expect(song.tracks.map((t) => t.channel)).toEqual([0, 9, 1, 2]);

    const parsed = parseMidi(projectToMidi(project));
    expect(parsed.bpm).toBeCloseTo(110, 3);
    const notes = parsed.tracks.find((t) => t.name === 'Oud')?.notes ?? [];
    expect(notes.map((n) => n.startBeat)).toEqual([4, 6]);
    expect(notes.every((n) => n.midi === 69)).toBe(true);
  });
});

/** Build a raw SMF by hand: format 0, running status, note-on vel 0 as off, two channels. */
function handMadeFormat0(): Uint8Array {
  const track = [
    0x00,
    0xff,
    0x51,
    0x03,
    0x07,
    0xa1,
    0x20, // tempo 500000 µs = 120 BPM
    0x00,
    0xff,
    0x51,
    0x03,
    0x09,
    0x27,
    0xc0, // a later tempo (ignored: first wins)
    0x00,
    0x90,
    60,
    100, // ch1 note on
    0x00,
    64,
    80, // running status: second note on
    0x60,
    60,
    0, // +96 ticks: note on vel 0 = off (running status)
    0x00,
    0x99,
    36,
    120, // ch10 kick
    0x30,
    0x89,
    36,
    0, // +48: kick off
    0x00,
    0xf0,
    0x02,
    0x7e,
    0xf7, // sysex, skipped
    0x30,
    0x80,
    64,
    0, // +48: second note off
    0x00,
    0xff,
    0x2f,
    0x00,
  ];
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96];
  const len = track.length;
  return new Uint8Array([
    ...header,
    0x4d,
    0x54,
    0x72,
    0x6b,
    0,
    0,
    (len >> 8) & 0xff,
    len & 0xff,
    ...track,
  ]);
}

describe('MIDI import', () => {
  it('reads format 0 with running status, splits channels, first tempo', () => {
    const parsed = parseMidi(handMadeFormat0());
    expect(parsed.format).toBe(0);
    expect(parsed.bpm).toBeCloseTo(120, 6);
    expect(parsed.tracks.map((t) => t.channel)).toEqual([0, 9]);
    const melodic = parsed.tracks[0]?.notes ?? [];
    expect(melodic.map((n) => [n.midi, n.startBeat, n.lengthBeats])).toEqual([
      [60, 0, 1],
      [64, 0, 2],
    ]);
    expect(parsed.tracks[1]?.notes[0]).toMatchObject({ midi: 36, startBeat: 1, lengthBeats: 0.5 });

    const tracks = midiToDawTracks(parsed, { instrument: 'keys', startBeat: 8, beatsPerBar: 4 });
    expect(tracks.map((t) => t.instrument)).toEqual(['keys', 'durbaan']);
    expect(tracks[0]?.regions[0]).toMatchObject({ startBeat: 8, lengthBeats: 4, loopCount: 1 });
    expect(tracks[0]?.regions[0]?.notes[0]?.velocity).toBeCloseTo(100 / 127, 6);
  });

  it('rejects non-MIDI and SMPTE data', () => {
    expect(() => parseMidi(new TextEncoder().encode('RIFF....WAVEfmt '))).toThrow(MidiParseError);
    const smpte = handMadeFormat0();
    smpte[12] = 0xe7; // -25 fps
    expect(() => parseMidi(smpte)).toThrow(/SMPTE/);
  });
});
