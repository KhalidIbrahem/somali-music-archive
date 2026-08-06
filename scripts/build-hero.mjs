#!/usr/bin/env node
/**
 * build-hero.mjs — engrave the landing hero excerpt (B1-10/11).
 *
 * Input: fixtures/hero-excerpt.mei (the hand-curated edition — see its header
 * for how to swap in Khalid's own recording).
 *
 * Outputs to apps/web/public/sample/:
 *   hero-desktop.svg  816px-wide engraving of all 12 bars
 *   hero-mobile.svg   ≤2 systems at larger scale (legible at 375px; §B1-10)
 *   hero-notes.json   per-note timing (derived FROM the MEI durations) and
 *                     per-variant notehead coordinates for the playhead
 *   hero-audio.mp3    plucked-string synthesis of the excerpt, sounding one
 *                     octave below written pitch (treble-8 clef semantics)
 *
 * The script asserts what B1-10 promises: no missing notes, at most two
 * mobile systems, staff-line spacing ≥ 6px on mobile.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'apps/web/public/sample');
const mei = readFileSync(join(root, 'fixtures/hero-excerpt.mei'), 'utf8');

// ── timing straight from the fixture (♪ = 0.21s; 6/8 lilt ≈ ♩· 95) ──────────
const EIGHTH_SEC = 0.21;
const DUR_EIGHTHS = { '8': 1, '4.': 3, '2.': 6 };
const noteTags = [...mei.matchAll(/<note xml:id="(hero-n\d+)" dur="(\d)"( dots="1")?[^>]*oct="(\d)"[^>]*pname="([a-g])"/g)];
if (noteTags.length !== 58) throw new Error(`expected 58 notes in fixture, got ${noteTags.length}`);

const PNAME_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
let cursor = 0;
const notes = noteTags.map((m) => {
  const [, id, dur, dots, oct, pname] = m;
  const key = dots ? `${dur}.` : dur;
  const eighths = DUR_EIGHTHS[key];
  if (!eighths) throw new Error(`unhandled duration ${key}`);
  const start = cursor;
  cursor += eighths * EIGHTH_SEC;
  const writtenMidi = 12 * (Number(oct) + 1) + PNAME_PC[pname];
  return { id, start, end: cursor, writtenMidi };
});
const durationSec = cursor + 1.6; // let the last pluck ring

// ── engrave ──────────────────────────────────────────────────────────────────
const verovio = await createVerovioModule();
const tk = new VerovioToolkit(verovio);
if (!tk.loadData(mei)) throw new Error('verovio rejected the hero MEI');

function render(scale, pageWidthUnits, pageHeightUnits, adjustPageHeight = true, breaks = 'auto') {
  tk.setOptions({
    scale,
    pageWidth: pageWidthUnits,
    pageHeight: pageHeightUnits,
    adjustPageHeight,
    breaks,
    header: 'none',
    footer: 'none',
    justifyVertically: false,
    spacingStaff: 8,
  });
  tk.redoLayout({});
  return tk.renderToSVG(1);
}

function svgMeta(svg) {
  const m = svg.match(/<svg[^>]*\swidth="(\d+)px"\sheight="(\d+)px"/);
  const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  if (!m || !vb) throw new Error('svg missing dimensions');
  return { wPx: +m[1], hPx: +m[2], viewW: +vb[1], viewH: +vb[2] };
}

function noteCoords(svg, meta) {
  const found = [];
  for (const n of notes) {
    const at = svg.indexOf(`id="${n.id}"`);
    if (at < 0) continue;
    const t = svg.slice(at, at + 600).match(/translate\((-?\d+),\s*(-?\d+)\)/);
    if (!t) throw new Error(`no coords for ${n.id}`);
    const fx = meta.wPx / meta.viewW;
    const fy = meta.hPx / meta.viewH;
    found.push({ id: n.id, x: Math.round(+t[1] * fx * 10) / 10, y: Math.round(+t[2] * fy * 10) / 10 });
  }
  return found;
}

const stripSize = (svg) =>
  svg.replace(/<svg([^>]*?)\swidth="(\d+)px"\sheight="(\d+)px"/, (_m, pre, w, h) => `<svg${pre} viewBox="0 0 ${w} ${h}"`);

// desktop: 816px wide, all bars — the encoded <sb/> puts the two six-bar
// phrases on two systems (no widowed final measure)
const dSvg = render(48, Math.round((816 * 100) / 48), 60000, true, 'line');
const dMeta = svgMeta(dSvg);
const dNotes = noteCoords(dSvg, dMeta);
if (dNotes.length !== 58) throw new Error(`desktop lost notes: ${dNotes.length}`);

// mobile: ~343px display, at most two systems — walk pageHeight down until ≤2
let mSvg = null;
let mMeta = null;
for (const ph of [700, 600, 520, 460, 420]) {
  // fixed page height (adjustPageHeight=false) so page 1 truly cuts at ≤2 systems
  const candidate = render(60, Math.round((343 * 100) / 60), ph, false);
  const systems = (candidate.match(/class="system"/g) ?? []).length;
  if (systems <= 2) {
    mSvg = candidate;
    mMeta = svgMeta(candidate);
    console.log(`mobile: pageHeight ${ph} → ${systems} system(s)`);
    break;
  }
}
if (!mSvg) throw new Error('could not fit mobile render into two systems');
const mNotes = noteCoords(mSvg, mMeta);
if (mNotes.length < 12) throw new Error(`mobile shows too few notes: ${mNotes.length}`);

// §B1-10 pass: staff-line spacing ≥ 6px on mobile
const staffAt = mSvg.indexOf('class="staff"');
const ys = [...mSvg.slice(staffAt, staffAt + 2000).matchAll(/M[0-9]+ ([0-9]+) L/g)].map((m) => +m[1]);
const gaps = ys.slice(1, 5).map((y, i) => (y - ys[i]) * (mMeta.hPx / mMeta.viewH));
const minGap = Math.min(...gaps);
if (!(minGap >= 6)) throw new Error(`mobile staff spacing ${minGap.toFixed(1)}px < 6px`);
console.log(`mobile staff spacing: ${minGap.toFixed(1)}px; notes shown: ${mNotes.length}/58`);

// ── plucked-string synthesis (Karplus-Strong), sounding an octave down ──────
const SR = 22050;
const buf = new Float32Array(Math.ceil(durationSec * SR));
for (const n of notes) {
  const f = 440 * Math.pow(2, (n.writtenMidi - 12 - 69) / 12);
  const N = Math.max(2, Math.round(SR / f));
  const ring = Math.min(2.2, Math.max(0.9, (n.end - n.start) * 1.8));
  const len = Math.min(buf.length - Math.floor(n.start * SR), Math.floor(ring * SR));
  const line = new Float32Array(N);
  let seed = (n.writtenMidi * 2654435761) >>> 0; // deterministic per note
  for (let i = 0; i < N; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    line[i] = (seed / 0xffffffff) * 2 - 1;
  }
  const s0 = Math.floor(n.start * SR);
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const cur = line[idx];
    const nxt = line[(idx + 1) % N];
    const out = cur;
    line[idx] = 0.996 * 0.5 * (cur + nxt);
    idx = (idx + 1) % N;
    buf[s0 + i] += out * 0.6 * Math.exp(-2.2 * (i / SR) / ring);
  }
}
let peak = 0;
for (const v of buf) peak = Math.max(peak, Math.abs(v));
const gain = peak > 0 ? 0.85 / peak : 1;
const pcm = Buffer.alloc(44 + buf.length * 2);
pcm.write('RIFF', 0);
pcm.writeUInt32LE(36 + buf.length * 2, 4);
pcm.write('WAVEfmt ', 8);
pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(1, 22);
pcm.writeUInt32LE(SR, 24);
pcm.writeUInt32LE(SR * 2, 28);
pcm.writeUInt16LE(2, 32);
pcm.writeUInt16LE(16, 34);
pcm.write('data', 36);
pcm.writeUInt32LE(buf.length * 2, 40);
for (let i = 0; i < buf.length; i++) {
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i] * gain)) * 32767), 44 + i * 2);
}
mkdirSync(outDir, { recursive: true });
const wavPath = join(tmpdir(), 'sma-hero.wav');
writeFileSync(wavPath, pcm);
execFileSync('ffmpeg', ['-y', '-i', wavPath, '-ac', '1', '-b:a', '64k', join(outDir, 'hero-audio.mp3')], { stdio: 'pipe' });
rmSync(wavPath);

writeFileSync(join(outDir, 'hero-desktop.svg'), stripSize(dSvg));
writeFileSync(join(outDir, 'hero-mobile.svg'), stripSize(mSvg));
writeFileSync(
  join(outDir, 'hero-notes.json'),
  JSON.stringify({
    durationSec: Math.round(durationSec * 1000) / 1000,
    times: notes.map((n) => ({ start: Math.round(n.start * 1000) / 1000, end: Math.round(n.end * 1000) / 1000 })),
    desktop: { wPx: dMeta.wPx, hPx: dMeta.hPx, notes: dNotes },
    mobile: { wPx: mMeta.wPx, hPx: mMeta.hPx, notes: mNotes },
  }),
);
console.log(`ok: 58 notes, ${durationSec.toFixed(1)}s, desktop ${dMeta.wPx}×${dMeta.hPx}, mobile ${mMeta.wPx}×${mMeta.hPx}`);
