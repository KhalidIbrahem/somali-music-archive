#!/usr/bin/env node
/**
 * Public-audio rights gate (runs as the web app's prebuild and in CI).
 *
 * Fails when an audio file that can ship with the web or mobile app is not
 * accounted for in apps/web/public-audio-rights.json, when a model-output file
 * comes from an adapter whose model card (docs/eval/MODEL_CARD_<adapter>.md)
 * is not `releasable`, or when the web source references a /demos/generated/
 * file that is not a releasable entry. A missing card or a missing rights
 * line counts as research-only: nothing is published by default.
 *
 * Why: the medium and large MusicGen adapters were trained on a corpus that is
 * 55 % Harvard Loeb recordings (research-only, DATA_PROVENANCE.md §1), and
 * four of their clips reached the public site. This makes that a build error.
 *
 * Usage: node apps/web/scripts/check-public-audio-rights.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|webm|aif|aiff)$/i;
export const SHIPPED_ROOTS = ['apps/web/public/', 'apps/mobile/assets/'];
const SOURCE_ROOTS = ['apps/web/app', 'apps/web/components', 'apps/web/lib', 'apps/web/public'];
const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|json|html|md)$/i;
const REF_RE = /\/demos\/(?:generated|gallery)\/[A-Za-z0-9._-]+/g;
const RIGHTS_RE = /\*\*Rights class:\*\*\s*`(releasable|research_only)`/;
const KINDS = new Set(['synthesised', 'model_output']);

/** The rights class a model card declares, or null when it declares none. */
export function cardRights(text) {
  const m = RIGHTS_RE.exec(text);
  return m ? m[1] : null;
}

/**
 * Pure check. `cards` maps adapter name → card text (undefined when there is
 * no card); `cardsAvailable` is false outside a git checkout (the Vercel build
 * has no .git and only part of docs/), and then the manifest's own `rights`
 * field is trusted — CI and local runs are git checkouts with every card and
 * cross-check it.
 * Returns a list of error strings; empty means pass.
 */
export function check({ audioFiles, manifest, cards, cardsAvailable, references }) {
  const errors = [];
  const entries = manifest.files ?? {};
  const present = new Set(audioFiles);

  for (const file of audioFiles) {
    if (!SHIPPED_ROOTS.some((r) => file.startsWith(r))) continue;
    if (!(file in entries))
      errors.push(`${file}: shipped audio not listed in public-audio-rights.json`);
  }

  for (const [file, e] of Object.entries(entries)) {
    if (!present.has(file))
      errors.push(`${file}: listed in public-audio-rights.json but not in the checkout`);
    if (!KINDS.has(e.kind)) {
      errors.push(`${file}: kind ${JSON.stringify(e.kind)} is not one of ${[...KINDS].join(', ')}`);
      continue;
    }
    if (e.kind !== 'model_output') continue;
    if (!e.adapter) {
      errors.push(`${file}: model_output without an adapter`);
      continue;
    }
    if (e.rights !== 'releasable') {
      errors.push(`${file}: adapter ${e.adapter} is ${e.rights ?? 'unclassified'}, not releasable`);
    }
    if (cardsAvailable) {
      const text = cards[e.adapter];
      const fromCard = text === undefined ? null : cardRights(text);
      if (text === undefined) {
        errors.push(
          `${file}: no model card docs/eval/MODEL_CARD_${e.adapter}.md (treated as research_only)`,
        );
      } else if (fromCard === null) {
        errors.push(
          `${file}: MODEL_CARD_${e.adapter}.md has no "**Rights class:**" line (treated as research_only)`,
        );
      } else if (fromCard !== 'releasable') {
        errors.push(`${file}: MODEL_CARD_${e.adapter}.md says ${fromCard}`);
      } else if (fromCard !== e.rights) {
        errors.push(
          `${file}: rights ${e.rights} disagree with MODEL_CARD_${e.adapter}.md (${fromCard})`,
        );
      }
    }
  }

  for (const { source, ref } of references) {
    const file = `apps/web/public${ref}`;
    const e = entries[file];
    if (!e || e.kind !== 'model_output' || e.rights !== 'releasable') {
      errors.push(
        `${source}: references ${ref}, which is not a releasable entry in public-audio-rights.json`,
      );
    }
  }
  return errors;
}

/** The checkout's files, and whether they came from git (CI, local) or a walk (deploy upload). */
function listFiles(root) {
  try {
    // Tracked plus untracked-but-not-ignored: what a commit or deploy would carry.
    const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // Deleted-but-not-yet-committed files are still in the index: count only what exists.
    const files = out.split('\0').filter((f) => f && existsSync(path.join(root, f)));
    return { files, fromGit: true };
  } catch {
    // No git (the Vercel build): walk what was uploaded.
    const files = [];
    const walk = (rel) => {
      const abs = path.join(root, rel);
      if (!existsSync(abs)) return;
      for (const name of readdirSync(abs)) {
        if (name === 'node_modules' || name === '.next') continue;
        const child = path.posix.join(rel, name);
        if (statSync(path.join(root, child)).isDirectory()) walk(child);
        else files.push(child);
      }
    };
    for (const r of [...SHIPPED_ROOTS, ...SOURCE_ROOTS]) walk(r.replace(/\/$/, ''));
    return { files: [...new Set(files)], fromGit: false };
  }
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const manifest = JSON.parse(
    readFileSync(path.join(root, 'apps/web/public-audio-rights.json'), 'utf8'),
  );
  const { files, fromGit } = listFiles(root);
  const audioFiles = files.filter((f) => AUDIO_RE.test(f));

  const cardsDir = path.join(root, 'docs/eval');
  // Vercel's upload has no .git and only part of docs/ (its first deploy of
  // this gate failed on "no model card"), so cards are only required in a git
  // checkout, where every card is present.
  const cardsAvailable = fromGit && existsSync(cardsDir);
  const cards = {};
  for (const e of Object.values(manifest.files ?? {})) {
    if (!e.adapter || e.adapter in cards) continue;
    const p = path.join(cardsDir, `MODEL_CARD_${e.adapter}.md`);
    cards[e.adapter] = existsSync(p) ? readFileSync(p, 'utf8') : undefined;
  }

  const references = [];
  for (const f of files) {
    if (!SOURCE_ROOTS.some((r) => f.startsWith(`${r}/`)) || !SOURCE_RE.test(f)) continue;
    const text = readFileSync(path.join(root, f), 'utf8');
    for (const m of text.matchAll(REF_RE)) references.push({ source: f, ref: m[0] });
  }

  const errors = check({ audioFiles, manifest, cards, cardsAvailable, references });

  // Every published clip must name the same adapter as its manifest entry.
  const pubPath = path.join(root, 'apps/web/lib/published-clips.json');
  if (existsSync(pubPath)) {
    const pub = JSON.parse(readFileSync(pubPath, 'utf8'));
    for (const c of [...(pub.generate ?? []), ...(pub.listen?.clips ?? [])]) {
      const e = manifest.files?.[`apps/web/public${c.file}`];
      if (e && e.adapter !== c.adapterId) {
        errors.push(
          `published-clips.json: ${c.id} says adapter ${c.adapterId}, manifest says ${e.adapter}`,
        );
      }
    }
  }
  const shipped = audioFiles.filter((f) => SHIPPED_ROOTS.some((r) => f.startsWith(r))).length;
  if (errors.length) {
    console.error(`public-audio rights check FAILED (${errors.length}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(
    `public-audio rights check passed: ${shipped} shipped audio files, ${references.length} /demos/generated references` +
      (cardsAvailable
        ? ', rights cross-checked against the model cards'
        : ' (no git checkout: manifest rights trusted, cards checked in CI)'),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
