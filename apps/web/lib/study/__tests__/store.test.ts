import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StudyResponse } from '../design';
import { STUDY_LIST_KEY, saveResponse, storeEnv, type StoreEnv } from '../store';

const record = {
  receivedAt: '2026-11-01T10:12:00.000Z',
  response: { session: 'abc12345' } as StudyResponse,
};

describe('study response store', () => {
  it('pushes onto the Redis list over REST when configured', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{"result":1}', { status: 200 });
    }) as unknown as typeof fetch;
    const env: StoreEnv = {
      url: 'https://x.upstash.io/',
      token: 't0k',
      production: true,
      localFile: '',
    };
    expect(await saveResponse(record, env, fake)).toEqual({ ok: true, where: 'redis' });
    expect(calls[0]!.url).toBe('https://x.upstash.io');
    expect((calls[0]!.init.headers as Record<string, string>)['Authorization']).toBe('Bearer t0k');
    const cmd = JSON.parse(calls[0]!.init.body as string) as string[];
    expect(cmd.slice(0, 2)).toEqual(['RPUSH', STUDY_LIST_KEY]);
    expect(JSON.parse(cmd[2]!)).toEqual(record);
  });

  it('reports a storage error instead of claiming success', async () => {
    const fail = (async () => new Response('no', { status: 500 })) as unknown as typeof fetch;
    const env: StoreEnv = { url: 'https://x', token: 't', production: true, localFile: '' };
    expect(await saveResponse(record, env, fail)).toEqual({ ok: false, reason: 'storage 500' });
  });

  it('writes a local file in development and refuses in an unconfigured production', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'study-')), 'r.jsonl');
    expect(await saveResponse(record, { production: false, localFile: file })).toEqual({
      ok: true,
      where: 'file',
    });
    expect(JSON.parse(readFileSync(file, 'utf8').trim())).toEqual(record);
    expect(await saveResponse(record, { production: true, localFile: file })).toEqual({
      ok: false,
      reason: 'not_configured',
    });
  });

  it('reads either Vercel KV or Upstash variable names', () => {
    expect(
      storeEnv({
        KV_REST_API_URL: 'a',
        KV_REST_API_TOKEN: 'b',
        NODE_ENV: 'production',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({ url: 'a', token: 'b', production: true });
    expect(
      storeEnv({
        UPSTASH_REDIS_REST_URL: 'c',
        UPSTASH_REDIS_REST_TOKEN: 'd',
      } as unknown as NodeJS.ProcessEnv),
    ).toMatchObject({ url: 'c', token: 'd', production: false });
  });
});
