/**
 * Minimal `.env` loader for local development (SESSION ".env loader").
 *
 * The API reads configuration from `process.env` (validated in config/env.ts); in
 * production those come from Doppler / AWS Secrets Manager. For local dev this
 * loads a `.env` file into `process.env` so `npm run dev` works without exporting
 * every variable by hand. Deliberately dependency-free and tiny.
 *
 * Semantics: an already-set variable ALWAYS wins (real shell/CI env overrides the
 * file), so this is safe to call unconditionally. Comments (`#` lines) and blank
 * lines are ignored; a single pair of surrounding quotes is stripped. Inline `#`
 * comments are NOT stripped — values may legitimately contain `#` (e.g. passwords),
 * and this repo's `.env` keeps comments on their own lines.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Parse `.env` text into key/value pairs. Pure — no process.env side effects. */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // Tolerate a leading `export ` (people paste shell-style .env files).
    const body = line.startsWith('export ') ? line.slice('export '.length).trimStart() : line;

    const eq = body.indexOf('=');
    if (eq === -1) continue; // skip stray/malformed lines rather than choke on them

    const key = body.slice(0, eq).trim();
    if (!key) continue;

    let value = body.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Load a `.env` file into `process.env` (existing variables are left untouched).
 * No-op when the file is absent. Defaults to `.env` in the current working
 * directory (the api package root when run via `npm run dev`).
 */
export function loadEnvFile(filePath: string = resolve(process.cwd(), '.env')): void {
  if (!existsSync(filePath)) return;
  const parsed = parseEnvFile(readFileSync(filePath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
