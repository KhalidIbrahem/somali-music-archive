// Deploy a project to Vercel via the REST API (undici fetch — bypasses the
// CLI's node-fetch agent, whose TLS session reuse fails on this network).
// Usage: node scripts/vercel-deploy.mjs <projectName> [--dry-run]
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEAM = 'team_3Z2IS2xU9dB5gQEqscilebhX';
const PROJECT = process.argv[2];
const DRY = process.argv.includes('--dry-run');
if (!PROJECT) throw new Error('usage: node api-deploy.mjs <projectName>');

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
const HEADERS = { Authorization: `Bearer ${resolveToken()}` };

// Source files: tracked + untracked-but-not-gitignored, then .vercelignore-style trims.
const raw = execSync('git ls-files -co --exclude-standard', { cwd: REPO, maxBuffer: 64e6 })
  .toString()
  .split('\n')
  .filter(Boolean);

const EXCLUDE_PREFIXES = [
  'apps/mobile/ios/', 'apps/mobile/android/', 'apps/mobile/.expo/',
  'apps/ai-service/', 'docs/', 'apps/api/api/', 'apps/api/dist/',
];
const EXCLUDE_SEGMENTS = ['node_modules/', '.next/', '.turbo/', '.vercel/', 'dist/'];
const files = raw.filter((f) => {
  if (EXCLUDE_PREFIXES.some((p) => f.startsWith(p))) return false;
  if (EXCLUDE_SEGMENTS.some((s) => f.includes(s))) return false;
  const base = f.split('/').pop();
  if (base === '.env' || (base.startsWith('.env.') && base !== '.env.example')) return false;
  if (base === '.DS_Store' || base.endsWith('.log')) return false;
  return true;
});
// The listening-room MP3s are deliberately gitignored (license_status=unknown
// audio must never enter git history), so `git ls-files` no longer sees them —
// but the DEPLOYED web app still serves them from /public/audio. Re-attach them
// from disk for the web project only.
if (PROJECT === 'somali-music-archive') {
  for (const dir of ['apps/web/public/audio', 'apps/web/public/demos/audio']) {
    const abs = join(REPO, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      if (name.endsWith('.mp3')) files.push(`${dir}/${name}`);
    }
  }
}

console.log(`files to upload: ${files.length}`);
if (DRY) {
  console.log(files.slice(0, 30).join('\n'));
  process.exit(0);
}

async function uploadWithRetry(buf, sha, path) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`https://api.vercel.com/v2/files?teamId=${TEAM}`, {
        method: 'POST',
        headers: {
          ...HEADERS,
          'x-vercel-digest': sha,
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(buf.length),
        },
        body: buf,
      });
      if (res.ok || res.status === 200) return;
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
    } catch (err) {
      if (attempt === 4) throw new Error(`upload failed for ${path}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

const manifest = [];
let uploaded = 0;
const CONCURRENCY = 6;
const queue = [...files];
async function worker() {
  while (queue.length) {
    const path = queue.shift();
    const abs = join(REPO, path);
    if (!existsSync(abs)) continue; // deleted in working tree but still tracked
    if (statSync(abs).size > 50 * 1024 * 1024) {
      console.log(`skipping >50MB file: ${path}`);
      continue;
    }
    const buf = readFileSync(abs);
    const sha = createHash('sha1').update(buf).digest('hex');
    await uploadWithRetry(buf, sha, path);
    manifest.push({ file: path, sha, size: buf.length });
    uploaded += 1;
    if (uploaded % 250 === 0) console.log(`uploaded ${uploaded}/${files.length}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

// The API project needs root-level rewrites (all paths -> the api function),
// which must NOT exist for the web project — inject a synthetic vercel.json
// into this deployment only, never onto disk.
if (PROJECT === 'somali-music-archive-api') {
  const cfg = Buffer.from(
    `${JSON.stringify({ rewrites: [{ source: '/(.*)', destination: '/api' }] }, null, 2)}\n`,
  );
  const sha = createHash('sha1').update(cfg).digest('hex');
  await uploadWithRetry(cfg, sha, 'vercel.json');
  manifest.push({ file: 'vercel.json', sha, size: cfg.length });

  // Function builders are assigned from the SOURCE manifest, so the entry must
  // be present at upload time even though the remote build regenerates it.
  const fn = readFileSync(join(REPO, 'apps/api/api/index.mjs'));
  const fnSha = createHash('sha1').update(fn).digest('hex');
  await uploadWithRetry(fn, fnSha, 'api/index.mjs');
  manifest.push({ file: 'api/index.mjs', sha: fnSha, size: fn.length });
}
console.log(`uploaded ${uploaded} files; creating deployment for ${PROJECT}...`);

const res = await fetch(`https://api.vercel.com/v13/deployments?teamId=${TEAM}`, {
  method: 'POST',
  headers: { ...HEADERS, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: PROJECT, project: PROJECT, target: 'production', files: manifest }),
});
const dep = await res.json();
if (!res.ok) {
  console.error('deployment create failed:', JSON.stringify(dep).slice(0, 500));
  process.exit(1);
}
console.log('deployment created:', dep.id, dep.url, 'state:', dep.readyState);

// Poll until the remote build finishes.
for (;;) {
  await new Promise((r) => setTimeout(r, 10_000));
  const s = await fetch(`https://api.vercel.com/v13/deployments/${dep.id}?teamId=${TEAM}`, {
    headers: HEADERS,
  }).then((r2) => r2.json());
  console.log('state:', s.readyState);
  if (s.readyState === 'READY') {
    console.log('DEPLOYED:', `https://${s.url}`, '| aliases:', (s.alias ?? []).join(', '));
    break;
  }
  if (s.readyState === 'ERROR' || s.readyState === 'CANCELED') {
    console.error('BUILD FAILED — check dashboard logs:', `https://${s.url}`);
    process.exit(1);
  }
}
