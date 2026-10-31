/**
 * Where listening-study responses go (server only).
 *
 * Production: an Upstash Redis list over its REST API, connected through
 * Vercel's Storage tab, which sets KV_REST_API_URL / KV_REST_API_TOKEN (or
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN). Development without
 * those: a local JSON-lines file, so the whole flow can be tested. Production
 * without them: not configured, and the page offers the participant a
 * download instead. No IP address or other request metadata is stored.
 */

import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import type { StudyResponse } from './design';

export const STUDY_LIST_KEY = 'study:qaraamigen-listening-v1:responses';

export interface StoredResponse {
  receivedAt: string;
  response: StudyResponse;
}

export type StoreResult = { ok: true; where: 'redis' | 'file' } | { ok: false; reason: string };

export interface StoreEnv {
  url?: string | undefined;
  token?: string | undefined;
  production: boolean;
  localFile: string;
}

export function storeEnv(env: NodeJS.ProcessEnv = process.env): StoreEnv {
  return {
    url: env['KV_REST_API_URL'] ?? env['UPSTASH_REDIS_REST_URL'],
    token: env['KV_REST_API_TOKEN'] ?? env['UPSTASH_REDIS_REST_TOKEN'],
    production: env['NODE_ENV'] === 'production',
    localFile: path.join(process.cwd(), '.study-responses.local.jsonl'),
  };
}

export async function saveResponse(
  record: StoredResponse,
  env: StoreEnv = storeEnv(),
  fetcher: typeof fetch = fetch,
): Promise<StoreResult> {
  const line = JSON.stringify(record);
  if (env.url && env.token) {
    const res = await fetcher(env.url.replace(/\/$/, ''), {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['RPUSH', STUDY_LIST_KEY, line]),
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, reason: `storage ${res.status}` };
    return { ok: true, where: 'redis' };
  }
  if (!env.production) {
    await appendFile(env.localFile, line + '\n', 'utf8');
    return { ok: true, where: 'file' };
  }
  return { ok: false, reason: 'not_configured' };
}
