import { describe, it, expect, vi, afterEach } from 'vitest';
import type { GenerateRequestInput } from '@sma/validators';
import { LyriaProvider } from './lyria';

const INPUT: GenerateRequestInput = {
  provider: 'lyria',
  prompt: 'A dhaanto rhythm with drums',
  instrumental: true,
  durationSec: 30,
};

function provider(): LyriaProvider {
  return new LyriaProvider({
    apiKey: 'test-key',
    model: 'lyria-3-clip-preview',
    timeoutMs: 5_000,
    baseUrl: 'https://lyria.test',
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LyriaProvider.submit', () => {
  it('sends the documented request and maps audio + lyrics to a completed track', async () => {
    const audio = Buffer.from([9, 8, 7]).toString('base64');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ output_audio: audio, output_text: 'verse one' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider().submit(INPUT);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://lyria.test/v1beta/interactions');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(init.body as string) as { model: string; input: string };
    expect(body.model).toBe('lyria-3-clip-preview');
    expect(body.input).toContain('dhaanto');
    expect(body.input).toContain('Instrumental only');
    expect(body.input).toContain('30 seconds');

    expect(result.kind).toBe('completed');
    if (result.kind === 'completed') {
      expect(result.track.audio).toEqual({
        kind: 'bytes',
        data: new Uint8Array([9, 8, 7]),
        mimeType: 'audio/mpeg',
      });
      expect(result.track.lyrics).toBe('verse one');
      expect(result.track.durationSec).toBe(30);
    }
  });

  it('honours a per-request model override', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ output_audio: 'AA==' }));
    vi.stubGlobal('fetch', fetchMock);

    await provider().submit({ ...INPUT, model: 'lyria-3-pro-preview' });
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as {
      model: string;
    };
    expect(body.model).toBe('lyria-3-pro-preview');
  });

  it('throws a safe generic error on a non-200 (no body leakage)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'secret' }, 500)));
    await expect(provider().submit(INPUT)).rejects.toThrow('Lyria request failed (HTTP 500)');
  });

  it('throws when the response carries no audio', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ output_text: 'only text' })));
    await expect(provider().submit(INPUT)).rejects.toThrow('Lyria returned no audio');
  });

  it('maps a fetch timeout to a readable message', async () => {
    const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));
    await expect(provider().submit(INPUT)).rejects.toThrow('Lyria timed out after 5s');
  });
});

describe('LyriaProvider.poll', () => {
  it('is defensively unreachable — reports failed', async () => {
    const result = await provider().poll('anything');
    expect(result).toEqual({ state: 'failed', error: 'Lyria generations complete at submission' });
  });
});
