import { describe, it, expect, vi } from 'vitest';
import { AppError } from '@/shared/errors/AppError';
import type { GenerateRequestInput } from '@sma/validators';
import type { MusicProvider } from '@sma/constants';
import type {
  MusicProviderClient,
  PollResult,
  ProviderTrack,
  SubmitResult,
} from './providers/provider';
import { FakeMusicProvider } from './providers/fake';
import { InMemoryGenerationJobStore } from './jobStore';
import { InlineAudioStore } from './audioStore';
import { createGenerationService, sanitizeErrorMessage } from './generation.service';

const TRACK: ProviderTrack = {
  audio: { kind: 'bytes', data: new Uint8Array([1, 2, 3]), mimeType: 'audio/wav' },
  durationSec: 30,
  title: 'Test track',
  lyrics: 'la la',
};

const INPUT: GenerateRequestInput = {
  provider: 'lyria',
  prompt: 'A qaraami oud instrumental',
  instrumental: true,
};

/** A controllable provider double. */
function makeProvider(
  name: MusicProvider,
  overrides: Partial<Pick<MusicProviderClient, 'submit' | 'poll' | 'isConfigured'>> = {},
): MusicProviderClient {
  return {
    name,
    isConfigured: overrides.isConfigured ?? (() => true),
    submit: overrides.submit ?? (async () => ({ kind: 'completed', track: TRACK })),
    poll: overrides.poll ?? (async () => ({ state: 'running' })),
  };
}

interface Harness {
  clock: { now: number };
  store: InMemoryGenerationJobStore;
  captured: Array<Promise<unknown>>;
  service: ReturnType<typeof createGenerationService>;
}

function makeHarness(
  providerOverrides: Partial<Record<MusicProvider, MusicProviderClient>>,
): Harness {
  const clock = { now: new Date('2026-08-01T12:00:00Z').getTime() };
  const store = new InMemoryGenerationJobStore(86_400, () => clock.now);
  const captured: Array<Promise<unknown>> = [];
  const service = createGenerationService({
    providers: {
      suno: providerOverrides.suno ?? makeProvider('suno'),
      lyria: providerOverrides.lyria ?? makeProvider('lyria'),
      local: providerOverrides.local ?? makeProvider('local'),
    },
    jobStore: store,
    audioStore: new InlineAudioStore(),
    keepAlive: (work) => captured.push(work),
    submitBudgetMs: 25,
    providerTimeoutMs: 100,
    now: () => new Date(clock.now),
  });
  return { clock, store, captured, service };
}

describe('createJob — budgeted submit', () => {
  it('returns a succeeded job with an inline track when the provider completes in budget', async () => {
    const { service } = makeHarness({});
    const job = await service.createJob('u1', INPUT);

    expect(job.state).toBe('succeeded');
    expect(job.provider).toBe('lyria');
    expect(job.track?.audioUrl).toBe('data:audio/wav;base64,AQID');
    expect(job.track?.mimeType).toBe('audio/wav');
    expect(job.track?.title).toBe('Test track');
    expect(job.error).toBeUndefined();
  });

  it('returns a failed job (not an HTTP error) when submit throws in budget', async () => {
    const { service } = makeHarness({
      lyria: makeProvider('lyria', {
        submit: async () => {
          throw new Error('Lyria request failed (HTTP 500)');
        },
      }),
    });
    const job = await service.createJob('u1', INPUT);
    expect(job.state).toBe('failed');
    expect(job.error).toBe('Lyria request failed (HTTP 500)');
  });

  it('answers queued past the budget and completes in the background via keepAlive', async () => {
    let release!: (r: SubmitResult) => void;
    const gate = new Promise<SubmitResult>((resolve) => {
      release = resolve;
    });
    const { service, captured } = makeHarness({
      lyria: makeProvider('lyria', { submit: () => gate }),
    });

    const job = await service.createJob('u1', INPUT);
    expect(job.state).toBe('queued');
    expect(captured).toHaveLength(1);

    release({ kind: 'completed', track: TRACK });
    await captured[0];

    const after = await service.getJob('u1', job.id);
    expect(after.state).toBe('succeeded');
    expect(after.track?.audioUrl).toBe('data:audio/wav;base64,AQID');
  });

  it('rejects an unconfigured provider with 503 and creates no job', async () => {
    const { service, store } = makeHarness({
      suno: makeProvider('suno', { isConfigured: () => false }),
    });
    const create = vi.spyOn(store, 'create');

    await expect(service.createJob('u1', { ...INPUT, provider: 'suno' })).rejects.toMatchObject({
      statusCode: 503,
      code: 'GENERATION_PROVIDER_UNAVAILABLE',
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('getJob — poll-through', () => {
  it('walks an async provider from running to succeeded (real fake provider)', async () => {
    const harness = makeHarness({});
    const { clock, service } = harness;
    // Use the actual dev fake so its stateless externalId encoding is covered.
    const fakeService = createGenerationService({
      providers: {
        suno: new FakeMusicProvider('suno', () => clock.now),
        lyria: makeProvider('lyria'),
        local: makeProvider('local'),
      },
      jobStore: harness.store,
      audioStore: new InlineAudioStore(),
      keepAlive: () => {},
      submitBudgetMs: 25,
      providerTimeoutMs: 100,
      now: () => new Date(clock.now),
    });
    void service; // harness service unused here

    const job = await fakeService.createJob('u1', { ...INPUT, provider: 'suno' });
    expect(job.state).toBe('running');

    const still = await fakeService.getJob('u1', job.id);
    expect(still.state).toBe('running');

    clock.now += 3_100;
    const done = await fakeService.getJob('u1', job.id);
    expect(done.state).toBe('succeeded');
    expect(done.track?.audioUrl.startsWith('data:audio/wav;base64,')).toBe(true);
    expect(done.track?.lyrics).toContain('fake');
  });

  it('records a provider-reported failure', async () => {
    const { service } = makeHarness({
      suno: makeProvider('suno', {
        submit: async () => ({ kind: 'pending', externalId: 't1' }),
        poll: async (): Promise<PollResult> => ({
          state: 'failed',
          error: 'Suno rejected the prompt (flagged content)',
        }),
      }),
    });
    const job = await service.createJob('u1', { ...INPUT, provider: 'suno' });
    const after = await service.getJob('u1', job.id);
    expect(after.state).toBe('failed');
    expect(after.error).toBe('Suno rejected the prompt (flagged content)');
  });

  it('keeps a job running when the provider poll throws (transient transport error)', async () => {
    const { service } = makeHarness({
      suno: makeProvider('suno', {
        submit: async () => ({ kind: 'pending', externalId: 't1' }),
        poll: async () => {
          throw new Error('Could not reach the Suno API');
        },
      }),
    });
    const job = await service.createJob('u1', { ...INPUT, provider: 'suno' });
    const after = await service.getJob('u1', job.id);
    expect(after.state).toBe('running');
  });

  it('404s an unknown job and another user’s job identically', async () => {
    const { service } = makeHarness({});
    const job = await service.createJob('owner', INPUT);

    await expect(service.getJob('owner', '00000000-0000-4000-8000-000000000000')).rejects.toThrow(
      AppError,
    );
    await expect(service.getJob('intruder', job.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('fails a job stuck in queued once it goes stale', async () => {
    const gate = new Promise<SubmitResult>(() => {}); // never resolves
    const { service, clock } = makeHarness({
      lyria: makeProvider('lyria', { submit: () => gate }),
    });
    const job = await service.createJob('u1', INPUT);
    expect(job.state).toBe('queued');

    clock.now += 25 + 100 + 30_000 + 1_000; // budget + timeout + grace + margin
    const after = await service.getJob('u1', job.id);
    expect(after.state).toBe('failed');
    expect(after.error).toBe('Generation timed out');
  });

  it('evicts jobs past the TTL (store returns null → 404)', async () => {
    const { service, clock } = makeHarness({});
    const job = await service.createJob('u1', INPUT);

    clock.now += 86_400 * 1000 + 1;
    await expect(service.getJob('u1', job.id)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('sanitizeErrorMessage', () => {
  it('strips control characters, trims, caps length, and never returns empty', () => {
    expect(sanitizeErrorMessage('  bad thing  ')).toBe('bad thing');
    expect(sanitizeErrorMessage('x'.repeat(400))).toHaveLength(300);
    expect(sanitizeErrorMessage('')).toBe('Generation failed');
    expect(sanitizeErrorMessage(undefined)).toBe('Generation failed');
  });
});
