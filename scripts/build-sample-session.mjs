#!/usr/bin/env node
/**
 * build-sample-session.mjs — build the studio's sample-session fixture from a
 * real notation-service job (B1-03).
 *
 *   node scripts/build-sample-session.mjs [jobDir]
 *
 * Reads the job's MusicXML + per-note JSON and writes to apps/web/public/sample/:
 *   score.mei    — engraving source (MusicXML → MEI via Verovio, ids kept)
 *   session.json — logical notes joined to MEI ids: {ids[], start, end, midi,
 *                  confidence, snapped, marked} + session meta
 *   audio.mp3    — audio SYNTHESIZED from the note list (never corpus audio —
 *                  Harvard recordings must not deploy; brief §9)
 *
 * The i-th logical note in the MEI (tied glyphs grouped) corresponds to the
 * i-th entry of the pipeline's note list — both descend from the same
 * monophonic melody in document order. The script asserts that equivalence
 * and refuses to write a fixture where the counts disagree.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jobDir =
  process.argv[2] ??
  join(root, 'apps/ai-service/data/notation_jobs/b0c21025d88a46e384ef76eb5231a01a');
const outDir = join(root, 'apps/web/public/sample');

// ── 1. MusicXML → MEI ────────────────────────────────────────────────────────

const musicxml = readFileSync(join(jobDir, 'vocals.musicxml'), 'utf8');
const notesJson = JSON.parse(readFileSync(join(jobDir, 'vocals.json'), 'utf8'));

const verovio = await createVerovioModule();
const tk = new VerovioToolkit(verovio);
if (!tk.loadData(musicxml)) throw new Error('verovio could not load the MusicXML');
const mei = tk.getMEI({ removeIds: false });

// ── 2. Group tied glyphs into logical notes, in document order ──────────────

const noteTags = [...mei.matchAll(/<note\b[^>]*>/g)].map((m) => m[0]);
const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]+)"`))?.[1];

const glyphs = noteTags.map((tag) => ({
  id: attr(tag, 'xml:id'),
  tie: attr(tag, 'tie') ?? null,
}));
if (glyphs.some((g) => !g.id)) throw new Error('MEI note without xml:id');
if (glyphs.some((g) => g.tie !== null)) {
  throw new Error('MEI uses @tie attributes — this script only handles <tie> elements');
}

// Ties are <tie startid="#a" endid="#b"/> elements. A glyph that is the endid
// of a tie joins the group of its startid; chains compose transitively.
const endToStart = new Map(
  [...mei.matchAll(/<tie\b[^>]*startid="#([^"]+)"[^>]*endid="#([^"]+)"/g)].map((m) => [
    m[2],
    m[1],
  ]),
);

const groupOf = new Map();
const logical = [];
for (const g of glyphs) {
  const startId = endToStart.get(g.id);
  const parent = startId === undefined ? undefined : groupOf.get(startId);
  if (parent !== undefined) {
    parent.push(g.id);
    groupOf.set(g.id, parent);
  } else {
    const group = [g.id];
    groupOf.set(g.id, group);
    logical.push(group);
  }
}

const pipelineNotes = notesJson.notes;
if (logical.length !== pipelineNotes.length) {
  throw new Error(
    `logical MEI notes (${logical.length}) != pipeline notes (${pipelineNotes.length}) — fixture would lie; aborting`,
  );
}

// ── 3. session.json ──────────────────────────────────────────────────────────

const session = {
  meta: {
    title: 'Sample session',
    instrument: 'Voice — codka',
    source: 'Somali Music Archive pipeline — notation job (vocals stem)',
    audio: 'synthesized from the transcription (no archival audio is deployed)',
    tonic: notesJson.tonic,
    degrees: notesJson.degrees,
    tuningOffsetCents: notesJson.tuning_offset_cents,
    bpm: notesJson.bpm,
    grid: notesJson.grid,
    nNotes: notesJson.n_notes,
    snapped: notesJson.snapped,
    markedOutliers: notesJson.marked_outliers,
    meanConfidence: notesJson.mean_confidence,
    durationSec: null, // filled below
  },
  notes: pipelineNotes.map((n, i) => ({
    ids: logical[i],
    start: n.start,
    end: n.end,
    midi: n.midi,
    confidence: n.confidence,
    snapped: n.snapped,
    marked: n.marked,
  })),
};

// ── 4. Synthesize audio from the note list ───────────────────────────────────

const SR = 22050;
const TAIL = 0.8;
const lastEnd = pipelineNotes[pipelineNotes.length - 1].end;
const durationSec = lastEnd + TAIL;
session.meta.durationSec = Math.round(durationSec * 1000) / 1000;

const buf = new Float32Array(Math.ceil(durationSec * SR));
const centsFactor = Math.pow(2, notesJson.tuning_offset_cents / 1200);
const HARMONICS = [1, 0.34, 0.16, 0.07];

for (const n of pipelineNotes) {
  const f0 = 440 * Math.pow(2, (n.midi - 69) / 12) * centsFactor;
  const s0 = Math.floor(n.start * SR);
  const s1 = Math.min(buf.length, Math.floor(n.end * SR));
  const len = s1 - s0;
  if (len <= 0) continue;
  const attack = Math.min(len, Math.round(0.02 * SR));
  const release = Math.min(len, Math.round(0.06 * SR));
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    // gentle vibrato after onset — reads as voice, not organ
    const vib = i > 0.12 * SR ? Math.sin(2 * Math.PI * 5.2 * t) * 0.007 : 0;
    const phase = 2 * Math.PI * f0 * (1 + vib) * t;
    let v = 0;
    for (let h = 0; h < HARMONICS.length; h++) v += HARMONICS[h] * Math.sin(phase * (h + 1));
    let env = 0.8;
    if (i < attack) env *= i / attack;
    if (len - i < release) env *= (len - i) / release;
    buf[s0 + i] += v * env;
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
const wavPath = join(tmpdir(), 'sma-sample-session.wav');
writeFileSync(wavPath, pcm);
execFileSync('ffmpeg', ['-y', '-i', wavPath, '-ac', '1', '-b:a', '64k', join(outDir, 'audio.mp3')], {
  stdio: 'pipe',
});
rmSync(wavPath);

// ── 5. Hero SVG for the landing page (B1-07) ────────────────────────────────
// First page of the real engraving, confidence ink baked in as attributes so
// the landing needs zero JavaScript to show the archive's signature.

const CONFIDENCE_INK = '#0C0B14';
const tierAlpha = (c) => (c >= 0.9 ? 1 : c >= 0.7 ? 0.62 : 0.34);

tk.setOptions({
  scale: 40,
  pageWidth: 2040,
  pageHeight: 2300,
  adjustPageHeight: false,
  breaks: 'auto',
  header: 'none',
  footer: 'none',
  justifyVertically: false,
});
tk.redoLayout({});
let hero = tk.renderToSVG(1);

for (let i = 0; i < pipelineNotes.length; i++) {
  const alpha = tierAlpha(pipelineNotes[i].confidence);
  if (alpha >= 1) continue;
  for (const id of logical[i]) {
    hero = hero.replace(`<g id="${id}" `, `<g id="${id}" fill-opacity="${alpha}" `);
  }
}
// Responsive + token ink: fixed px dimensions become a viewBox so the page
// scales with its container, and the root fill is the confidence ink.
hero = hero.replace(
  /<svg([^>]*?)\swidth="(\d+)px"\sheight="(\d+)px"/,
  (_m, pre, w, h) => `<svg${pre} viewBox="0 0 ${w} ${h}" fill="${CONFIDENCE_INK}"`,
);
writeFileSync(join(outDir, 'hero.svg'), hero);

// ── 6. Mobile reader assets (B1-08) ──────────────────────────────────────────
// The Expo score reader renders pre-paginated SVG pages (react-native-svg has
// no Verovio), with each logical note's page + y position extracted here so
// the reader can auto-scroll with playback. Confidence ink is baked in.

const MOBILE_DIR = join(root, 'apps/mobile/assets/sample');
const PAGE_W_UNITS = 2040; // → 816 px at scale 40
const PAGE_H_UNITS = 2640; // → 1056 px
const UNIT_TO_PX = 0.04;

tk.setOptions({
  scale: 40,
  pageWidth: PAGE_W_UNITS,
  pageHeight: PAGE_H_UNITS,
  adjustPageHeight: false,
  breaks: 'auto',
  header: 'none',
  footer: 'none',
  justifyVertically: false,
});
tk.redoLayout({});

const pageCount = tk.getPageCount();
const pages = [];
for (let p = 1; p <= pageCount; p++) {
  let svg = tk.renderToSVG(p);
  for (let i = 0; i < pipelineNotes.length; i++) {
    const alpha = tierAlpha(pipelineNotes[i].confidence);
    if (alpha >= 1) continue;
    for (const id of logical[i]) {
      svg = svg.replace(`<g id="${id}" `, `<g id="${id}" fill-opacity="${alpha}" `);
    }
  }
  svg = svg.replace(
    /<svg([^>]*?)\swidth="(\d+)px"\sheight="(\d+)px"/,
    (_m, pre, w, h) => `<svg${pre} viewBox="0 0 ${w} ${h}" fill="${CONFIDENCE_INK}"`,
  );
  pages.push(svg);
}

const readerNotes = pipelineNotes.map((n, i) => {
  const id = logical[i][0];
  const page = tk.getPageWithElement(id); // 1-based; 0 = not found
  if (page < 1) throw new Error(`note ${i} (${id}) not on any page`);
  const svg = pages[page - 1];
  const at = svg.indexOf(`id="${id}"`);
  // Verovio places the notehead <use> via transform="translate(x, y)".
  const m = at >= 0 ? svg.slice(at, at + 600).match(/translate\((-?\d+),\s*(-?\d+)\)/) : null;
  if (!m) throw new Error(`no position found for note ${i} (${id})`);
  return {
    start: n.start,
    end: n.end,
    page: page - 1,
    y: Math.round(Number(m[2]) * UNIT_TO_PX),
    confidence: n.confidence,
  };
});

mkdirSync(MOBILE_DIR, { recursive: true });
writeFileSync(
  join(MOBILE_DIR, 'score-pages.json'),
  JSON.stringify({ width: 816, height: 1056, pages }),
);
writeFileSync(
  join(MOBILE_DIR, 'notes.json'),
  JSON.stringify({ durationSec: session.meta.durationSec, notes: readerNotes }),
);
copyFileSync(join(outDir, 'audio.mp3'), join(MOBILE_DIR, 'audio.mp3'));

// ── 7. Write outputs ─────────────────────────────────────────────────────────

writeFileSync(join(outDir, 'score.mei'), mei);
writeFileSync(join(outDir, 'session.json'), JSON.stringify(session));
writeFileSync(
  join(outDir, 'README.md'),
  `# Sample session fixture

Generated by \`node scripts/build-sample-session.mjs\` from a real notation-service
job (vocals stem). \`score.mei\` is the pipeline's MusicXML converted with Verovio;
\`session.json\` joins each logical note (tied glyphs grouped) to its MEI ids with
the pipeline's performance timing and confidence. \`audio.mp3\` is **synthesized
from the note list** — no archival recording is deployed (brief §9).
`,
);

console.log(
  `ok: ${logical.length} logical notes, ${(durationSec / 60).toFixed(1)} min, ` +
    `tiers h/m/l = ${pipelineNotes.filter((n) => n.confidence >= 0.9).length}/${
      pipelineNotes.filter((n) => n.confidence >= 0.7 && n.confidence < 0.9).length
    }/${pipelineNotes.filter((n) => n.confidence < 0.7).length}`,
);
