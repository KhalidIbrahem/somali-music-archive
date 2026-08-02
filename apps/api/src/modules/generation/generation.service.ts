/**
 * Generation service — provider-agnostic job orchestration.
 *
 * The two hard problems this file owns:
 *
 * 1. SYNC PROVIDERS ON SERVERLESS (budgeted submit): Lyria generates inside a
 *    single 30–90s HTTP call, but mobile's axios timeout is 20s, so POST can't
 *    just await it. createJob() starts the submission, waits up to
 *    submitBudgetMs (fast outcomes — Suno's ~1s task handoff, fake provider,
 *    bad-key errors — return with their final state immediately), and past the
 *    budget hands the SAME in-flight promise to keepAlive (Vercel waitUntil)
 *    and answers 201 queued. The client was going to poll anyway.
 *
 * 2. NO BACKGROUND WORKERS (poll-through): nothing on a serverless platform
 *    polls Suno between requests. Instead each authenticated GET of the job
 *    drives one provider poll and persists any transition. A staleness
 *    failsafe fails jobs stuck in `queued` (a killed instance lost the
 *    background promise) after budget + provider timeout + grace.
 */

import { randomUUID } from 'node:crypto';
import type { GenerationJob, GeneratedTrack } from '@sma/types';
import type { MusicProvider } from '@sma/constants';
import type { GenerateRequestInput } from '@sma/validators';
import { AppError, notFound } from '@/shared/errors/AppError';
import { logger } from '@/shared/logger';
import { env } from '@/config/env';
import type { MusicProviderClient, ProviderTrack } from './providers/provider';
import { providerRegistry } from './providers/registry';
import {
  selectJobStore,
  type GenerationJobStore,
  type StoredGenerationJob,
  type StoredGeneratedTrack,
} from './jobStore';
import { resolveAudioUrl, selectAudioStore, type GeneratedAudioStore } from './audioStore';
import { keepAlive as vercelKeepAlive, type KeepAlive } from './keepAlive';

const log = logger.child({ module: 'generation' });

/** Grace period on top of budget+timeout before a stuck `queued` job is failed. */
const STALE_GRACE_MS = 30_000;

/** Keep provider failure text safe for clients: printable, short, single-line. */
export function sanitizeErrorMessage(message: string | undefined): string {
  const cleaned = (message ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 300);
  return cleaned.length > 0 ? cleaned : 'Generation failed';
}

export function createGenerationService(deps: {
  providers: Record<MusicProvider, MusicProviderClient>;
  jobStore: GenerationJobStore;
  audioStore: GeneratedAudioStore;
  keepAlive: KeepAlive;
  submitBudgetMs: number;
  providerTimeoutMs: number;
  now?: () => Date;
}) {
  const { providers, jobStore, audioStore, keepAlive } = deps;
  const now = deps.now ?? (() => new Date());

  /** Persist a provider track's bytes/URL and shape it for storage. */
  async function persistTrack(track: ProviderTrack): Promise<StoredGeneratedTrack> {
    const audioRef = await audioStore.persist(track.audio);
    return {
      audioRef,
      mimeType: track.audio.mimeType,
      ...(track.durationSec !== undefined ? { durationSec: track.durationSec } : {}),
      ...(track.title !== undefined ? { title: track.title } : {}),
      ...(track.lyrics !== undefined ? { lyrics: track.lyrics } : {}),
    };
  }

  /** Run the provider submission and record the outcome on the job. */
  async function submitAndRecord(
    jobId: string,
    client: MusicProviderClient,
    input: GenerateRequestInput,
  ): Promise<StoredGenerationJob | null> {
    const stamp = () => ({ updatedAt: now().toISOString() });
    try {
      const result = await client.submit(input);
      if (result.kind === 'completed') {
        const track = await persistTrack(result.track);
        log.info({ jobId, provider: client.name }, 'generation completed at submit');
        return jobStore.update(jobId, { state: 'succeeded', track, ...stamp() });
      }
      log.info(
        { jobId, provider: client.name, externalId: result.externalId },
        'generation task handed to provider',
      );
      return jobStore.update(jobId, {
        state: 'running',
        externalId: result.externalId,
        ...stamp(),
      });
    } catch (err) {
      log.warn({ err, jobId, provider: client.name }, 'generation submit failed');
      return jobStore.update(jobId, {
        state: 'failed',
        error: sanitizeErrorMessage(err instanceof Error ? err.message : undefined),
        ...stamp(),
      });
    }
  }

  /** Poll the provider once for a running job and persist any transition. */
  async function pollAndRecord(job: StoredGenerationJob): Promise<StoredGenerationJob> {
    const client = providers[job.provider];
    if (!job.externalId) return job;
    try {
      const result = await client.poll(job.externalId);
      if (result.state === 'running') return job;
      const stamp = { updatedAt: now().toISOString() };
      if (result.state === 'succeeded') {
        const track = await persistTrack(result.track);
        log.info({ jobId: job.id, provider: job.provider }, 'generation succeeded');
        return (await jobStore.update(job.id, { state: 'succeeded', track, ...stamp })) ?? job;
      }
      log.info({ jobId: job.id, provider: job.provider }, 'generation failed at provider');
      return (
        (await jobStore.update(job.id, {
          state: 'failed',
          error: sanitizeErrorMessage(result.error),
          ...stamp,
        })) ?? job
      );
    } catch (err) {
      // Transient transport trouble — stay `running`; the next poll retries and
      // the job TTL bounds the worst case.
      log.warn({ err, jobId: job.id, provider: job.provider }, 'provider poll failed; will retry');
      return job;
    }
  }

  /** Fail a job stuck in `queued` (lost background promise on a dead instance). */
  async function failIfStale(job: StoredGenerationJob): Promise<StoredGenerationJob> {
    const staleAfterMs = deps.submitBudgetMs + deps.providerTimeoutMs + STALE_GRACE_MS;
    const age = now().getTime() - new Date(job.createdAt).getTime();
    if (age <= staleAfterMs) return job;
    log.warn({ jobId: job.id, provider: job.provider, age }, 'queued job went stale');
    return (
      (await jobStore.update(job.id, {
        state: 'failed',
        error: 'Generation timed out',
        updatedAt: now().toISOString(),
      })) ?? job
    );
  }

  /** Strip internals and resolve the audio reference into a playable URL. */
  async function toWire(job: StoredGenerationJob): Promise<GenerationJob> {
    let track: GeneratedTrack | undefined;
    if (job.track) {
      track = {
        audioUrl: await resolveAudioUrl(job.track.audioRef),
        mimeType: job.track.mimeType,
        ...(job.track.durationSec !== undefined ? { durationSec: job.track.durationSec } : {}),
        ...(job.track.title !== undefined ? { title: job.track.title } : {}),
        ...(job.track.lyrics !== undefined ? { lyrics: job.track.lyrics } : {}),
      };
    }
    return {
      id: job.id,
      provider: job.provider,
      state: job.state,
      prompt: job.prompt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      ...(track ? { track } : {}),
      ...(job.error !== undefined ? { error: job.error } : {}),
    };
  }

  async function createJob(userId: string, input: GenerateRequestInput): Promise<GenerationJob> {
    const client = providers[input.provider];
    if (!client.isConfigured()) {
      throw new AppError(
        503,
        'GENERATION_PROVIDER_UNAVAILABLE',
        `The ${input.provider} provider is not configured on this server`,
      );
    }

    const createdAt = now().toISOString();
    const job: StoredGenerationJob = {
      id: randomUUID(),
      userId,
      provider: input.provider,
      state: 'queued',
      prompt: input.prompt,
      createdAt,
      updatedAt: createdAt,
    };
    await jobStore.create(job);

    // Budgeted submit: fast outcomes return final state now; slow ones keep
    // running after the response via keepAlive (see module docblock).
    const submission = submitAndRecord(job.id, client, input);
    const budget = new Promise<'budget-elapsed'>((resolve) => {
      const timer = setTimeout(() => resolve('budget-elapsed'), deps.submitBudgetMs);
      // Don't hold a long-lived dev process open for the losing branch.
      timer.unref?.();
    });

    const raced = await Promise.race([submission, budget]);
    if (raced !== 'budget-elapsed') {
      return toWire(raced ?? job);
    }
    keepAlive(submission);
    return toWire(job);
  }

  async function getJob(userId: string, jobId: string): Promise<GenerationJob> {
    let job = await jobStore.get(jobId);
    // Same 404 for missing and not-yours: don't leak job existence.
    if (!job || job.userId !== userId) throw notFound();

    if (job.state === 'queued') job = await failIfStale(job);
    if (job.state === 'running') job = await pollAndRecord(job);

    return toWire(job);
  }

  return { createJob, getJob };
}

export type GenerationService = ReturnType<typeof createGenerationService>;

export const generationService: GenerationService = createGenerationService({
  providers: providerRegistry,
  jobStore: selectJobStore(),
  audioStore: selectAudioStore(),
  keepAlive: vercelKeepAlive,
  submitBudgetMs: env.GENERATION_SUBMIT_BUDGET_MS,
  providerTimeoutMs: env.GENERATION_PROVIDER_TIMEOUT_MS,
});
