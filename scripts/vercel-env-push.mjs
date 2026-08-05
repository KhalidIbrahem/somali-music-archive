// Push the API's production environment to the Vercel project
// `somali-music-archive-api` via the REST API (the CLI's TLS agent is
// unreliable on this network — same reason vercel-deploy.mjs exists).
// Reads values from apps/api/.env; prints VARIABLE NAMES ONLY, never values.
//
//   node scripts/vercel-env-push.mjs [--dry-run]
//
// Serverless overrides applied (same semantics as the original sh script):
// POSTGRES_URL is switched to the Supavisor TRANSACTION pooler (port 6543,
// pgbouncer=true, one connection per lambda), PERSISTENCE=database,
// RATE_LIMIT_BACKEND=redis, API_URL/CORS_ORIGINS point at the deployed domains.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEAM = 'team_3Z2IS2xU9dB5gQEqscilebhX';
const PROJECT = 'somali-music-archive-api';
const DRY = process.argv.includes('--dry-run');

// Token resolution: durable token first (env or git-ignored .vercel-token
// file — CLI login sessions on this machine keep expiring), CLI auth last.
import { existsSync as _ex, readFileSync as _rf } from 'node:fs';
function resolveToken() {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN.trim();
  const f = join(REPO, '.vercel-token');
  if (_ex(f)) return _rf(f, 'utf8').trim();
  const auth = JSON.parse(
    _rf(join(os.homedir(), 'Library/Application Support/com.vercel.cli/auth.json'), 'utf8'),
  );
  return auth.token;
}
const HEADERS = { Authorization: `Bearer ${resolveToken()}`, 'Content-Type': 'application/json' };

// Minimal .env parse — same semantics as apps/api loadEnv.ts (comments/blank
// skipped, one pair of surrounding quotes stripped, inline # kept).
const envText = readFileSync(join(REPO, 'apps/api/.env'), 'utf8');
const fileEnv = {};
for (const rawLine of envText.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq === -1) continue;
  const key = line.slice(0, eq).trim();
  let value = line.slice(eq + 1).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  if (key) fileEnv[key] = value;
}

/** Required in production — abort if missing from .env. */
const REQUIRED = [
  'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'MONGODB_URI', 'REDIS_URL',
  'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_DOMAIN',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PREMIUM_PRICE_ID', 'STRIPE_INSTITUTIONAL_PRICE_ID',
  'RESEND_API_KEY', 'EMAIL_FROM', 'AI_SERVICE_URL', 'AI_SERVICE_API_KEY',
];
/** Pushed only when present+non-empty in .env (envSchema defaults cover the rest). */
const OPTIONAL = [
  'SUNO_API_KEY', 'SUNO_API_BASE_URL', 'SUNO_MODEL',
  'GEMINI_API_KEY', 'LYRIA_MODEL',
  'OPENROUTER_API_KEY', 'OPENROUTER_BASE_URL', 'OPENROUTER_LYRIA_MODEL',
  'GENERATION_PROVIDER_TIMEOUT_MS', 'GENERATION_SUBMIT_BUDGET_MS',
  'GENERATION_JOB_TTL_SEC', 'GENERATION_CALLBACK_URL',
];

const vars = {};
const missing = REQUIRED.filter((k) => !fileEnv[k]);
if (missing.length) {
  console.error('missing required vars in apps/api/.env:', missing.join(', '));
  process.exit(1);
}
for (const k of REQUIRED) vars[k] = fileEnv[k];
for (const k of OPTIONAL) if (fileEnv[k]) vars[k] = fileEnv[k];

// Serverless-specific overrides (see header).
vars['POSTGRES_URL'] =
  fileEnv['POSTGRES_URL'].replace(':5432/', ':6543/') + '?pgbouncer=true&connection_limit=1';
vars['PERSISTENCE'] = 'database';
vars['RATE_LIMIT_BACKEND'] = 'redis';
vars['API_URL'] = 'https://somali-music-archive-api.vercel.app';
vars['CORS_ORIGINS'] = 'https://somali-music-archive.vercel.app';
// NODE_ENV deliberately NOT pushed — Vercel sets it and treats it as reserved.

const names = Object.keys(vars);
console.log(`pushing ${names.length} production vars to ${PROJECT}:`);
console.log(names.map((n) => `  - ${n}`).join('\n'));
if (DRY) process.exit(0);

// Batch upsert — one request, encrypted at rest, production target only.
const payload = names.map((key) => ({
  key,
  value: vars[key],
  type: 'encrypted',
  target: ['production'],
}));
const res = await fetch(
  `https://api.vercel.com/v10/projects/${PROJECT}/env?teamId=${TEAM}&upsert=true`,
  { method: 'POST', headers: HEADERS, body: JSON.stringify(payload) },
);
const body = await res.json();
if (!res.ok) {
  console.error('env push failed:', res.status, JSON.stringify(body).slice(0, 400));
  process.exit(1);
}
const created = (body.created ?? []).length;
const failed = body.failed ?? [];
console.log(`done: ${created} upserted, ${failed.length} failed`);
if (failed.length) {
  for (const f of failed) console.error('  ✗', f.error?.key ?? '?', f.error?.message ?? '');
  process.exit(1);
}
console.log('Now redeploy so the new env takes effect:');
console.log('  node scripts/vercel-deploy.mjs somali-music-archive-api');
