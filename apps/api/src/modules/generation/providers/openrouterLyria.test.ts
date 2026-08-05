import { describe, it, expect, vi, afterEach } from 'vitest';
import type { GenerateRequestInput } from '@sma/validators';
import { OpenRouterLyriaProvider } from './openrouterLyria';

const INPUT: GenerateRequestInput = {
  provider: 'lyria',
  prompt: 'A dhaanto rhythm with drums',
  instrumental: true,
};

function provider(): OpenRouterLyriaProvider {
  return new OpenRouterLyriaProvider({
    apiKey: 'or-test-key',
    baseUrl: 'https://openrouter.test/api/v1',
    model: 'google/lyria-3-clip-preview',
    timeoutMs: 5_000,
  });
}

/** Build the SSE body OpenRouter streams for audio output. */
function sse(...frames: unknown[]): string {
  return [...frames.map((f) => `data: ${JSON.stringify(f)}`), 'data: [DONE]', ''].join('\n\n');
}

const audioFrame = (data: string, transcript?: string): unknown => ({
  choices: [{ delta: { audio: { data, ...(transcript ? { transcript } : {}) } } }],
});

function stubFetch(body: string, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(body, {
      status,
      headers: { 'content-type': status === 200 ? 'text/event-stream' : 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenRouterLyriaProvider.submit', () => {
  it('sends the documented streaming request and reassembles chunked base64 audio', async () => {
    // AQI= = bytes [1,2]; Aw== = bytes [3] — decoded per chunk, then concatenated.
    const fetchMock = stubFetch(sse(audioFrame('AQI=', 'la '), audioFrame('Aw==', 'la')));

    const result = await provider().submit(INPUT);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.test/api/v1/chat/completions');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer or-test-key');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'google/lyria-3-clip-preview',
      modalities: ['text', 'audio'],
      audio: { format: 'mp3' },
      stream: true,
    });
    expect((body['messages'] as Array<{ content: string }>)[0]?.content).toContain(
      'Instrumental only',
    );

    expect(result.kind).toBe('completed');
    if (result.kind === 'completed') {
      expect(result.track.audio).toEqual({
        kind: 'bytes',
        data: new Uint8Array([1, 2, 3]),
        mimeType: 'audio/mpeg',
      });
      expect(result.track.lyrics).toBe('la la');
    }
  });

  it('prefixes a bare model override with the google/ namespace', async () => {
    const fetchMock = stubFetch(sse(audioFrame('AA==')));
    await provider().submit({ ...INPUT, model: 'lyria-3-pro-preview' });
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as { model: string };
    expect(body.model).toBe('google/lyria-3-pro-preview');
  });

  it('gives a clear message when credits run out (402)', async () => {
    stubFetch(JSON.stringify({ error: { message: 'Insufficient credits' } }), 402);
    await expect(provider().submit(INPUT)).rejects.toThrow(
      'OpenRouter credits exhausted — top up at openrouter.ai/credits',
    );
  });

  it('surfaces the provider message on other HTTP failures', async () => {
    stubFetch(JSON.stringify({ error: { message: 'model overloaded' } }), 502);
    await expect(provider().submit(INPUT)).rejects.toThrow(
      'OpenRouter request failed (HTTP 502): model overloaded',
    );
  });

  it('surfaces the model’s words when a text-only stream carries no audio (refusals)', async () => {
    stubFetch(sse({ choices: [{ delta: { content: 'I cannot imitate that artist.' } }] }));
    await expect(provider().submit(INPUT)).rejects.toThrow(
      'Lyria returned no audio — model said: I cannot imitate that artist.',
    );
  });

  it('throws a hint when the stream has neither audio nor text', async () => {
    stubFetch(sse({ choices: [{ delta: { role: 'assistant' } }] }));
    await expect(provider().submit(INPUT)).rejects.toThrow('OpenRouter returned no audio');
  });

  it('maps a fetch timeout to a readable message', async () => {
    const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));
    await expect(provider().submit(INPUT)).rejects.toThrow('OpenRouter timed out after 5s');
  });
});

describe('OpenRouterLyriaProvider.poll', () => {
  it('is defensively unreachable — reports failed', async () => {
    expect(await provider().poll('x')).toEqual({
      state: 'failed',
      error: 'OpenRouter generations complete at submission',
    });
  });
});
