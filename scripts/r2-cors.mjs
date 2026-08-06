#!/usr/bin/env node
/**
 * r2-cors.mjs — set the R2 bucket's CORS rules (idempotent; run after bucket
 * creation or origin changes).
 *
 *   node scripts/r2-cors.mjs [--dry-run]
 *
 * The platform's upload architecture PUTs files straight from the browser to
 * R2 via presigned URLs (CONVENTIONS.md: audio/documents never travel through
 * Node). That only works if the bucket answers CORS preflights for our web
 * origins — R2 buckets ship with NO CORS rules, which blocks every
 * browser-side upload with an opaque network error.
 *
 * Origins are the production web app and local dev. Preview deployments are
 * deliberately NOT included (https://*.vercel.app would admit every Vercel
 * app on the internet); add specific preview URLs here if ever needed.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, GetBucketCorsCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');

const env = Object.fromEntries(
  readFileSync(join(REPO, 'apps/api/.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']) {
  if (!env[k]) throw new Error(`missing ${k} in apps/api/.env`);
}

const CORS_RULES = [
  {
    AllowedOrigins: ['https://somali-music-archive.vercel.app', 'http://localhost:3000'],
    // PUT: presigned uploads. GET/HEAD: signed read URLs fetched from the app.
    AllowedMethods: ['PUT', 'GET', 'HEAD'],
    AllowedHeaders: ['content-type'],
    ExposeHeaders: ['etag'],
    MaxAgeSeconds: 3600,
  },
];

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
});

console.log(`bucket: ${env.R2_BUCKET_NAME}`);
try {
  const current = await client.send(new GetBucketCorsCommand({ Bucket: env.R2_BUCKET_NAME }));
  console.log('current rules:', JSON.stringify(current.CORSRules));
} catch (err) {
  console.log(`current rules: none (${err.name})`);
}

if (DRY) {
  console.log('would apply:', JSON.stringify(CORS_RULES, null, 1));
  process.exit(0);
}

await client.send(
  new PutBucketCorsCommand({
    Bucket: env.R2_BUCKET_NAME,
    CORSConfiguration: { CORSRules: CORS_RULES },
  }),
);
const after = await client.send(new GetBucketCorsCommand({ Bucket: env.R2_BUCKET_NAME }));
console.log('applied rules:', JSON.stringify(after.CORSRules, null, 1));
