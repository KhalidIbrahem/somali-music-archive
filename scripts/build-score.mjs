#!/usr/bin/env node
/**
 * build-score.mjs — parse a score's MIDI into the notes JSON the web player
 * consumes (same fixture pattern as build-hero/build-sample-session).
 *
 *   node scripts/build-score.mjs apps/web/public/scores/beerdilaacshe
 *
 * Reads the first .midi/.mid in the directory, writes notes.json beside it:
 *   { bpm, timeSignature, durationSec, noteCount,
 *     notes: [{ midi, start, end, velocity }] }
 *
 * Minimal Standard MIDI File reader: format 0/1, running status, VLQs,
 * tempo map from all tracks (last-wins at a tick), note-off = 8x or 9x@vel0.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node scripts/build-score.mjs <score-dir>');
const midiName = readdirSync(dir).find((f) => /\.midi?$/i.test(f));
if (!midiName) throw new Error(`no .midi file in ${dir}`);
const buf = readFileSync(join(dir, midiName));

let pos = 0;
const u32 = () => (pos += 4, buf.readUInt32BE(pos - 4));
const u16 = () => (pos += 2, buf.readUInt16BE(pos - 2));
const u8 = () => buf[pos++];
const chunk = () => buf.subarray(pos, pos + 4).toString('latin1');

function vlq() {
  let v = 0;
  for (;;) {
    const b = u8();
    v = (v << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) return v;
  }
}

if (chunk() !== 'MThd') throw new Error('not a MIDI file');
pos += 4;
u32(); // header length consumed via explicit reads below
pos -= 4;
const hdrLen = u32();
const format = u16();
const ntrks = u16();
const division = u16();
pos += hdrLen - 6;
if (division & 0x8000) throw new Error('SMPTE division not supported');

const tempoMap = [{ tick: 0, usPerQn: 500_000 }];
const rawNotes = [];
const timeSig = { num: 4, den: 4 };

for (let t = 0; t < ntrks; t++) {
  if (chunk() !== 'MTrk') throw new Error(`track ${t}: missing MTrk`);
  pos += 4;
  const len = u32();
  const end = pos + len;
  let tick = 0;
  let running = 0;
  const open = new Map(); // key: ch<<8|midi → {startTick, velocity}
  while (pos < end) {
    tick += vlq();
    let status = u8();
    if (status < 0x80) {
      pos--;
      status = running;
    } else if (status < 0xf0) {
      running = status;
    }
    if (status === 0xff) {
      const type = u8();
      const mlen = vlq();
      if (type === 0x51 && mlen === 3) {
        const usPerQn = (u8() << 16) | (u8() << 8) | u8();
        tempoMap.push({ tick, usPerQn });
      } else if (type === 0x58 && mlen >= 2) {
        timeSig.num = u8();
        timeSig.den = 2 ** u8();
        pos += mlen - 2;
      } else {
        pos += mlen;
      }
    } else if (status === 0xf0 || status === 0xf7) {
      pos += vlq();
    } else {
      const kind = status & 0xf0;
      const ch = status & 0x0f;
      if (kind === 0x90 || kind === 0x80) {
        const note = u8();
        const vel = u8();
        const key = (ch << 8) | note;
        if (kind === 0x90 && vel > 0) {
          open.set(key, { startTick: tick, velocity: vel });
        } else {
          const on = open.get(key);
          if (on) {
            rawNotes.push({ midi: note, startTick: on.startTick, endTick: tick, velocity: on.velocity });
            open.delete(key);
          }
        }
      } else if (kind === 0xc0 || kind === 0xd0) {
        pos += 1;
      } else {
        pos += 2;
      }
    }
  }
  pos = end;
}

tempoMap.sort((a, b) => a.tick - b.tick);
function tickToSec(tick) {
  let sec = 0;
  let lastTick = 0;
  let usPerQn = 500_000;
  for (const ev of tempoMap) {
    if (ev.tick >= tick) break;
    sec += ((ev.tick - lastTick) / division) * (usPerQn / 1e6);
    lastTick = ev.tick;
    usPerQn = ev.usPerQn;
  }
  return sec + ((tick - lastTick) / division) * (usPerQn / 1e6);
}

const notes = rawNotes
  .map((n) => ({
    midi: n.midi,
    start: Math.round(tickToSec(n.startTick) * 1000) / 1000,
    end: Math.round(tickToSec(n.endTick) * 1000) / 1000,
    velocity: Math.round((n.velocity / 127) * 100) / 100,
  }))
  .sort((a, b) => a.start - b.start);

const lastTempo = tempoMap[tempoMap.length - 1];
const bpm = Math.round(60_000_000 / lastTempo.usPerQn);
const durationSec = Math.max(...notes.map((n) => n.end));

const out = {
  bpm,
  timeSignature: `${timeSig.num}/${timeSig.den}`,
  durationSec: Math.round(durationSec * 1000) / 1000,
  noteCount: notes.length,
  notes,
};
writeFileSync(join(dir, 'notes.json'), JSON.stringify(out));
console.log(
  `ok: format ${format}, ${ntrks} tracks, ${notes.length} notes, ${bpm} bpm, ${timeSig.num}/${timeSig.den}, ${durationSec.toFixed(1)}s, range ${Math.min(...notes.map((n) => n.midi))}–${Math.max(...notes.map((n) => n.midi))}`,
);
