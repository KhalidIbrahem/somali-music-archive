/**
 * Standard MIDI File read/write (Studio v2 import/export) — no dependency.
 *
 * Reader: format 0 and 1, PPQ division, running status, sysex and meta
 * events; note-on/off pairing is first-in-first-out per (channel, key) and a
 * note-on with velocity 0 counts as a note-off. Tempo: the first Set Tempo
 * event (the DAW has one BPM per project); ticks map to beats through the
 * file's division, so note positions are tempo-independent.
 *
 * Writer: format 1 — a conductor track (name, tempo, time signature) plus one
 * track per DAW MIDI track. Durbaan tracks go to channel 10 (index 9, the GM
 * percussion channel); the rest take channels 1–16 in order, skipping 10.
 */

import {
  BPM_MAX,
  BPM_MIN,
  newId,
  newRegion,
  newTrack,
  trackKind,
  type DawNote,
  type DawProject,
  type DawTrack,
  type InstrumentId,
} from './types';

export const DEFAULT_PPQ = 480;
const PERCUSSION_CHANNEL = 9;

/** One note in musical time, the shape both directions share. */
export interface MidiNote {
  startBeat: number;
  lengthBeats: number;
  midi: number;
  /** 0–1 (MIDI 1–127 / 127). */
  velocity: number;
}

export interface MidiTrackData {
  name: string;
  /** 0–15. */
  channel: number;
  notes: MidiNote[];
}

export interface MidiSong {
  /** Beats per minute (first tempo in the file; 120 when the file has none). */
  bpm: number;
  timeSignature: { beatsPerBar: number; beatUnit: number };
  tracks: MidiTrackData[];
}

export interface ParsedMidi extends MidiSong {
  format: 0 | 1 | 2;
  ppq: number;
  /** Whether the file carried a Set Tempo event at all. */
  hasTempo: boolean;
}

export class MidiParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MidiParseError';
  }
}

// ── reading ──────────────────────────────────────────────────────────────────

class Reader {
  pos = 0;
  constructor(
    private readonly bytes: Uint8Array,
    private readonly end: number = bytes.length,
  ) {}

  get done(): boolean {
    return this.pos >= this.end;
  }

  u8(): number {
    if (this.pos >= this.end) throw new MidiParseError('unexpected end of data');
    const value = this.bytes[this.pos];
    this.pos += 1;
    return value ?? 0;
  }

  u16(): number {
    return (this.u8() << 8) | this.u8();
  }

  u32(): number {
    return ((this.u8() << 24) >>> 0) + (this.u8() << 16) + (this.u8() << 8) + this.u8();
  }

  ascii(length: number): string {
    let out = '';
    for (let i = 0; i < length; i++) out += String.fromCharCode(this.u8());
    return out;
  }

  vlq(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = this.u8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new MidiParseError('variable-length quantity longer than 4 bytes');
  }

  slice(length: number): Uint8Array {
    if (this.pos + length > this.end) throw new MidiParseError('chunk runs past end of data');
    const out = this.bytes.subarray(this.pos, this.pos + length);
    this.pos += length;
    return out;
  }

  skip(length: number): void {
    this.slice(length);
  }
}

interface RawNote {
  tick: number;
  durationTicks: number;
  midi: number;
  velocity: number;
  channel: number;
}

interface RawTrack {
  name: string;
  notes: RawNote[];
  tempos: { tick: number; usPerQuarter: number }[];
  timeSignature: { beatsPerBar: number; beatUnit: number } | null;
}

function readTrack(data: Uint8Array): RawTrack {
  const r = new Reader(data);
  const track: RawTrack = { name: '', notes: [], tempos: [], timeSignature: null };
  /** Open notes per channel*128+key, oldest first. */
  const open = new Map<number, { tick: number; velocity: number }[]>();
  let tick = 0;
  let status = 0;

  const close = (channel: number, midi: number, at: number): void => {
    const stack = open.get(channel * 128 + midi);
    const started = stack?.shift();
    if (!started) return; // stray note-off
    track.notes.push({
      tick: started.tick,
      durationTicks: Math.max(0, at - started.tick),
      midi,
      velocity: started.velocity,
      channel,
    });
  };

  while (!r.done) {
    tick += r.vlq();
    let byte = r.u8();
    if (byte === 0xff) {
      const type = r.u8();
      const length = r.vlq();
      const payload = r.slice(length);
      if (type === 0x2f) break; // end of track
      if (type === 0x03 && track.name === '') {
        track.name = new TextDecoder().decode(payload).trim();
      } else if (type === 0x51 && length === 3) {
        track.tempos.push({
          tick,
          usPerQuarter: ((payload[0] ?? 0) << 16) | ((payload[1] ?? 0) << 8) | (payload[2] ?? 0),
        });
      } else if (type === 0x58 && length >= 2 && track.timeSignature === null) {
        track.timeSignature = {
          beatsPerBar: payload[0] ?? 4,
          beatUnit: Math.pow(2, payload[1] ?? 2),
        };
      }
      continue;
    }
    if (byte === 0xf0 || byte === 0xf7) {
      r.skip(r.vlq());
      continue;
    }
    if (byte < 0x80) {
      // Running status: this byte is the first data byte.
      if (status === 0) throw new MidiParseError('running status with no previous status');
      r.pos -= 1;
      byte = status;
    } else {
      status = byte;
    }
    const kind = byte & 0xf0;
    const channel = byte & 0x0f;
    if (kind === 0xc0 || kind === 0xd0) {
      r.u8();
      continue;
    }
    const d1 = r.u8();
    const d2 = r.u8();
    if (kind === 0x90 && d2 > 0) {
      const key = channel * 128 + d1;
      const stack = open.get(key) ?? [];
      stack.push({ tick, velocity: d2 });
      open.set(key, stack);
    } else if (kind === 0x80 || kind === 0x90) {
      close(channel, d1, tick);
    }
    // 0xA0 aftertouch, 0xB0 controllers, 0xE0 pitch bend: ignored.
  }
  // Notes never switched off end at the track's last tick.
  for (const [key, stack] of open) {
    for (let i = stack.length; i > 0; i--) close(Math.floor(key / 128), key % 128, tick);
  }
  track.notes.sort((a, b) => a.tick - b.tick || a.midi - b.midi);
  return track;
}

/** Decode a .mid file. Tracks are split by channel; empty (conductor) tracks are dropped. */
export function parseMidi(input: ArrayBuffer | Uint8Array): ParsedMidi {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const r = new Reader(bytes);
  if (bytes.length < 14 || r.ascii(4) !== 'MThd') throw new MidiParseError('not a MIDI file');
  const headerLength = r.u32();
  const format = r.u16();
  const trackCount = r.u16();
  const division = r.u16();
  r.skip(headerLength - 6);
  if (format > 2) throw new MidiParseError(`unknown MIDI format ${format}`);
  if (division & 0x8000) throw new MidiParseError('SMPTE time division is not supported');
  const ppq = division;
  if (ppq === 0) throw new MidiParseError('division of 0 ticks per quarter note');

  const raws: RawTrack[] = [];
  while (!r.done && raws.length < trackCount) {
    const id = r.ascii(4);
    const length = r.u32();
    const data = r.slice(length);
    if (id === 'MTrk') raws.push(readTrack(data));
  }

  const firstTempo = raws
    .flatMap((t) => t.tempos)
    .sort((a, b) => a.tick - b.tick)
    .find((t) => t.usPerQuarter > 0);
  const bpm = firstTempo ? 60_000_000 / firstTempo.usPerQuarter : 120;
  const timeSignature = raws.find((t) => t.timeSignature !== null)?.timeSignature ?? {
    beatsPerBar: 4,
    beatUnit: 4,
  };

  const tracks: MidiTrackData[] = [];
  raws.forEach((raw, index) => {
    const channels = [...new Set(raw.notes.map((n) => n.channel))].sort((a, b) => a - b);
    for (const channel of channels) {
      const base = raw.name || `Track ${index + 1}`;
      tracks.push({
        name: channels.length > 1 ? `${base} (ch ${channel + 1})` : base,
        channel,
        notes: raw.notes
          .filter((n) => n.channel === channel)
          .map((n) => ({
            startBeat: n.tick / ppq,
            lengthBeats: n.durationTicks / ppq,
            midi: n.midi,
            velocity: n.velocity / 127,
          })),
      });
    }
  });

  return {
    format: format as 0 | 1 | 2,
    ppq,
    bpm,
    hasTempo: firstTempo !== undefined,
    timeSignature,
    tracks,
  };
}

// ── writing ──────────────────────────────────────────────────────────────────

function vlqBytes(value: number): number[] {
  let v = Math.max(0, Math.floor(value));
  const out = [v & 0x7f];
  v >>>= 7;
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return out;
}

function textBytes(text: string): number[] {
  return [...new TextEncoder().encode(text)];
}

function chunk(id: string, body: number[]): number[] {
  const length = body.length;
  return [
    ...[...id].map((c) => c.charCodeAt(0)),
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...body,
  ];
}

interface TimedEvent {
  tick: number;
  /** Sort order at equal ticks: meta first, then note-offs, then note-ons. */
  order: number;
  bytes: number[];
}

function trackChunk(events: TimedEvent[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let last = 0;
  for (const event of events) {
    body.push(...vlqBytes(event.tick - last), ...event.bytes);
    last = event.tick;
  }
  body.push(0x00, 0xff, 0x2f, 0x00);
  return chunk('MTrk', body);
}

function metaText(type: number, text: string): number[] {
  const payload = textBytes(text);
  return [0xff, type, ...vlqBytes(payload.length), ...payload];
}

export function midiVelocity(velocity: number): number {
  return Math.max(1, Math.min(127, Math.round(velocity * 127)));
}

/** Encode a song as a format-1 Standard MIDI File. */
export function encodeMidi(song: MidiSong & { name?: string }, ppq = DEFAULT_PPQ): Uint8Array {
  const usPerQuarter = Math.round(60_000_000 / song.bpm);
  const denominatorPower = Math.round(Math.log2(song.timeSignature.beatUnit));
  const conductor: TimedEvent[] = [
    { tick: 0, order: 0, bytes: metaText(0x03, song.name ?? 'QaraamiGen Studio') },
    {
      tick: 0,
      order: 0,
      bytes: [
        0xff,
        0x51,
        0x03,
        (usPerQuarter >>> 16) & 0xff,
        (usPerQuarter >>> 8) & 0xff,
        usPerQuarter & 0xff,
      ],
    },
    {
      tick: 0,
      order: 0,
      bytes: [0xff, 0x58, 0x04, song.timeSignature.beatsPerBar, denominatorPower, 24, 8],
    },
  ];

  const chunks: number[] = [...trackChunk(conductor)];
  for (const track of song.tracks) {
    const channel = Math.max(0, Math.min(15, track.channel));
    const events: TimedEvent[] = [{ tick: 0, order: 0, bytes: metaText(0x03, track.name) }];
    for (const note of track.notes) {
      const midi = Math.max(0, Math.min(127, Math.round(note.midi)));
      const on = Math.max(0, Math.round(note.startBeat * ppq));
      const off = Math.max(on + 1, Math.round((note.startBeat + note.lengthBeats) * ppq));
      events.push({
        tick: on,
        order: 2,
        bytes: [0x90 | channel, midi, midiVelocity(note.velocity)],
      });
      events.push({ tick: off, order: 1, bytes: [0x80 | channel, midi, 0x40] });
    }
    chunks.push(...trackChunk(events));
  }

  const trackCount = song.tracks.length + 1;
  const header = chunk('MThd', [
    0x00,
    0x01,
    (trackCount >>> 8) & 0xff,
    trackCount & 0xff,
    (ppq >>> 8) & 0xff,
    ppq & 0xff,
  ]);
  return new Uint8Array([...header, ...chunks]);
}

// ── DAW project ⇄ MIDI ───────────────────────────────────────────────────────

/** Absolute-beat notes of one DAW track, loops unrolled, notes past a region's end dropped (as the engine plays it). */
export function trackToMidiNotes(track: DawTrack): MidiNote[] {
  const notes: MidiNote[] = [];
  for (const region of track.regions) {
    for (let pass = 0; pass < region.loopCount; pass++) {
      const passStart = region.startBeat + pass * region.lengthBeats;
      for (const note of region.notes) {
        if (note.startBeat >= region.lengthBeats) continue;
        notes.push({
          startBeat: passStart + note.startBeat,
          lengthBeats: note.lengthBeats,
          midi: note.midi,
          velocity: note.velocity,
        });
      }
    }
  }
  return notes.sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);
}

/** The project's MIDI tracks as a song (audio tracks are skipped). */
export function projectToMidiSong(project: DawProject): MidiSong & { name: string } {
  let nextChannel = 0;
  const tracks: MidiTrackData[] = [];
  for (const track of project.tracks) {
    if (trackKind(track) !== 'midi') continue;
    let channel: number;
    if (track.instrument === 'durbaan') {
      channel = PERCUSSION_CHANNEL;
    } else {
      if (nextChannel === PERCUSSION_CHANNEL) nextChannel += 1;
      channel = nextChannel % 16;
      nextChannel += 1;
    }
    tracks.push({ name: track.name, channel, notes: trackToMidiNotes(track) });
  }
  return {
    name: project.name,
    bpm: project.bpm,
    timeSignature: { ...project.timeSignature },
    tracks,
  };
}

export function projectToMidi(project: DawProject): Uint8Array {
  return encodeMidi(projectToMidiSong(project));
}

export interface MidiImportOptions {
  /** Instrument for melodic channels (percussion channel 10 always becomes durbaan). */
  instrument: InstrumentId;
  /** Where the imported regions start on the timeline, in beats. */
  startBeat: number;
  beatsPerBar: number;
}

/** One DAW MIDI track (one region) per MIDI track/channel that has notes. */
export function midiToDawTracks(parsed: MidiSong, options: MidiImportOptions): DawTrack[] {
  const out: DawTrack[] = [];
  for (const source of parsed.tracks) {
    if (source.notes.length === 0) continue;
    const instrument: InstrumentId =
      source.channel === PERCUSSION_CHANNEL ? 'durbaan' : options.instrument;
    const track = newTrack(source.name.slice(0, 80) || 'MIDI', instrument);
    const end = Math.max(...source.notes.map((n) => n.startBeat + n.lengthBeats));
    const bar = Math.max(1, options.beatsPerBar);
    const region = newRegion(options.startBeat, Math.max(bar, Math.ceil(end / bar) * bar));
    region.notes = source.notes.map((n): DawNote => ({
      id: newId('nt'),
      startBeat: n.startBeat,
      lengthBeats: Math.max(1 / 64, n.lengthBeats),
      midi: n.midi,
      velocity: Math.max(0, Math.min(1, n.velocity)),
    }));
    track.regions = [region];
    out.push(track);
  }
  return out;
}

/** A file tempo clamped to the project's BPM range, rounded to a whole BPM. */
export function clampBpm(bpm: number): number {
  return Math.round(Math.min(BPM_MAX, Math.max(BPM_MIN, bpm)));
}
