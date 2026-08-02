import { describe, it, expect, vi, afterEach } from 'vitest';
import type { GenerateRequestInput } from '@sma/validators';
import { SunoProvider } from './suno';

const INPUT: GenerateRequestInput = {
  provider: 'suno',
  prompt: 'A gentle qaraami love song with solo oud',
  instrumental: false,
};

function provider(): SunoProvider {
  return new SunoProvider({
    apiKey: 'test-key',
    baseUrl: 'https://suno.test',
    model: 'V5',
    callbackUrl: 'https://api.example.com/api/v1/generate/callback',
    timeoutMs: 5_000,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body, status));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** A record-info payload with the given status (and optionally a track). */
function pollBody(status: string, withTrack = false, errorMessage?: string): unknown {
  return {
    code: 200,
    msg: 'success',
    data: {
      status,
      errorMessage: errorMessage ?? null,
      response: withTrack
        ? {
            sunoData: [
              {
                audioUrl: 'https://cdn.suno.test/track.mp3',
                title: 'Qaraami Nights',
                duration: 187.3,
                prompt: '[Verse] ...',
              },
            ],
          }
        : null,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SunoProvider.submit', () => {
  it('sends the documented non-custom request with auth + callBackUrl and returns the taskId', async () => {
    const fetchMock = stubFetch({ code: 200, msg: 'success', data: { taskId: 'task-42' } });

    const result = await provider().submit(INPUT);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://suno.test/api/v1/generate');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer test-key');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      customMode: false,
      instrumental: false,
      model: 'V5',
      callBackUrl: 'https://api.example.com/api/v1/generate/callback',
      prompt: INPUT.prompt,
    });

    expect(result).toEqual({ kind: 'pending', externalId: 'task-42' });
  });

  it('throws with the reseller message when the envelope code is not 200', async () => {
    stubFetch({ code: 429, msg: 'insufficient credits', data: null });
    await expect(provider().submit(INPUT)).rejects.toThrow(
      'Suno rejected the request: insufficient credits',
    );
  });

  it('throws a safe generic error on an HTTP failure', async () => {
    stubFetch({ anything: true }, 502);
    await expect(provider().submit(INPUT)).rejects.toThrow('Suno request failed (HTTP 502)');
  });

  it('maps a fetch timeout to a readable message', async () => {
    const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));
    await expect(provider().submit(INPUT)).rejects.toThrow('Suno timed out after 5s');
  });
});

describe('SunoProvider.poll', () => {
  it('URL-encodes the task id into the record-info query', async () => {
    const fetchMock = stubFetch(pollBody('PENDING'));
    await provider().poll('task/42&x');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://suno.test/api/v1/generate/record-info?taskId=task%2F42%26x');
  });

  it.each(['PENDING', 'TEXT_SUCCESS', 'FIRST_SUCCESS'])('maps %s to running', async (status) => {
    stubFetch(pollBody(status));
    expect(await provider().poll('t')).toEqual({ state: 'running' });
  });

  it('maps SUCCESS with audio to a succeeded url track', async () => {
    stubFetch(pollBody('SUCCESS', true));
    const result = await provider().poll('t');
    expect(result).toEqual({
      state: 'succeeded',
      track: {
        audio: { kind: 'url', url: 'https://cdn.suno.test/track.mp3', mimeType: 'audio/mpeg' },
        durationSec: 187,
        title: 'Qaraami Nights',
        lyrics: '[Verse] ...',
      },
    });
  });

  it('fails SUCCESS without any audio payload', async () => {
    stubFetch(pollBody('SUCCESS'));
    expect(await provider().poll('t')).toEqual({
      state: 'failed',
      error: 'Suno reported success but returned no audio',
    });
  });

  it.each([
    ['CREATE_TASK_FAILED', 'Suno could not start the generation task'],
    ['GENERATE_AUDIO_FAILED', 'Suno failed while generating the audio'],
    ['SENSITIVE_WORD_ERROR', 'Suno rejected the prompt (flagged content)'],
  ])('maps %s to failed', async (status, message) => {
    stubFetch(pollBody(status, false, 'details'));
    expect(await provider().poll('t')).toEqual({
      state: 'failed',
      error: `${message}: details`,
    });
  });

  it('treats CALLBACK_EXCEPTION with audio as succeeded (unreachable dev callback)', async () => {
    stubFetch(pollBody('CALLBACK_EXCEPTION', true));
    const result = await provider().poll('t');
    expect(result.state).toBe('succeeded');
  });

  it('treats CALLBACK_EXCEPTION without audio as failed', async () => {
    stubFetch(pollBody('CALLBACK_EXCEPTION'));
    expect((await provider().poll('t')).state).toBe('failed');
  });

  it('stays running on an unknown status value', async () => {
    stubFetch(pollBody('SOME_NEW_STATUS'));
    expect(await provider().poll('t')).toEqual({ state: 'running' });
  });

  it('stays running on a malformed envelope', async () => {
    stubFetch({ code: 500, msg: 'oops' });
    expect(await provider().poll('t')).toEqual({ state: 'running' });
  });

  it('throws on an HTTP failure so the service can keep the job running', async () => {
    stubFetch({}, 503);
    await expect(provider().poll('t')).rejects.toThrow('Suno request failed (HTTP 503)');
  });
});
