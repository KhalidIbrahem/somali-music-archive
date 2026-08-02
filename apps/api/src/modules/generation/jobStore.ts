/**
 * Generation job persistence (ADR-0005 interface-first).
 *
 * WHY a store at all: the API runs as Vercel serverless functions in
 * production, so POST /generate and the subsequent GET polls land on DIFFERENT
 * instances — module state cannot carry a job across. Mirrors the established
 * backend split: in-memory for dev/tests (zero infrastructure), Redis
 * (Upstash) when RATE_LIMIT_BACKEND=redis, selected by the same
 * useRedisBackend() switch so one flag keeps all cross-instance state
 * consistent.
 *
 * Jobs are EPHEMERAL by design (TTL, default 24h): the durable archive object
 * is a future "save recording" flow, not the generation job. This is why
 * eviction is acceptable and soft-delete rules do not apply here.
 */

import type { GenerationJobState, MusicProvider } from '@sma/constants';
import { connectRedis, getRedis, useRedisBackend } from '@/shared/cache/redisClient';
import { env } from '@/config/env';
import type { StoredAudioRef } from './audioStore';

/** A finished track as persisted — audio held by reference, never inline bytes. */
export interface StoredGeneratedTrack {
  readonly audioRef: StoredAudioRef;
  readonly mimeType: string;
  readonly durationSec?: number;
  readonly title?: string;
  readonly lyrics?: string;
}

/** The stored job — a superset of the wire GenerationJob (internals stripped
 * by the service before anything leaves the API). */
export interface StoredGenerationJob {
  readonly id: string;
  readonly userId: string;
  readonly provider: MusicProvider;
  readonly state: GenerationJobState;
  readonly prompt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly externalId?: string;
  readonly track?: StoredGeneratedTrack;
  readonly error?: string;
}

export type StoredJobPatch = Partial<
  Pick<StoredGenerationJob, 'state' | 'externalId' | 'track' | 'error' | 'updatedAt'>
>;

export interface GenerationJobStore {
  create(job: StoredGenerationJob): Promise<void>;
  get(id: string): Promise<StoredGenerationJob | null>;
  /** Merge a patch into the job; returns the updated job (null if evicted). */
  update(id: string, patch: StoredJobPatch): Promise<StoredGenerationJob | null>;
}

// ── In-memory (dev/test) ──────────────────────────────────────────────────────

export class InMemoryGenerationJobStore implements GenerationJobStore {
  private readonly jobs = new Map<string, { job: StoredGenerationJob; expiresAt: number }>();

  constructor(
    private readonly ttlSec: number,
    private readonly now: () => number = Date.now,
  ) {}

  async create(job: StoredGenerationJob): Promise<void> {
    this.sweep();
    this.jobs.set(job.id, { job, expiresAt: this.now() + this.ttlSec * 1000 });
  }

  async get(id: string): Promise<StoredGenerationJob | null> {
    const entry = this.jobs.get(id);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.jobs.delete(id);
      return null;
    }
    return entry.job;
  }

  async update(id: string, patch: StoredJobPatch): Promise<StoredGenerationJob | null> {
    const current = await this.get(id);
    if (!current) return null;
    const next: StoredGenerationJob = { ...current, ...patch };
    const entry = this.jobs.get(id);
    if (entry) entry.job = next; // keep the original expiry — TTL is from creation
    return next;
  }

  /** Lazy eviction on write — no timers, so nothing to clean up on shutdown. */
  private sweep(): void {
    const now = this.now();
    for (const [id, entry] of this.jobs) {
      if (entry.expiresAt <= now) this.jobs.delete(id);
    }
  }
}

// ── Redis (production / serverless) ───────────────────────────────────────────

const keyOf = (id: string): string => `gen:job:${id}`;

export class RedisGenerationJobStore implements GenerationJobStore {
  constructor(private readonly ttlSec: number) {}

  async create(job: StoredGenerationJob): Promise<void> {
    await this.write(job);
  }

  async get(id: string): Promise<StoredGenerationJob | null> {
    await connectRedis();
    const raw = await getRedis().get(keyOf(id));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredGenerationJob;
    } catch {
      return null; // corrupt entry — treat as evicted rather than 500 forever
    }
  }

  async update(id: string, patch: StoredJobPatch): Promise<StoredGenerationJob | null> {
    const current = await this.get(id);
    if (!current) return null;
    const next: StoredGenerationJob = { ...current, ...patch };
    await this.write(next);
    return next;
  }

  private async write(job: StoredGenerationJob): Promise<void> {
    await connectRedis();
    // Re-set the TTL on every write: simpler than KEEPTTL and a running job
    // being actively updated deserves its full window anyway.
    await getRedis().set(keyOf(job.id), JSON.stringify(job), {
      expiration: { type: 'EX', value: this.ttlSec },
    });
  }
}

/** Same backend switch as the rate limiter/token blacklist — one flag, all
 * cross-instance state together. */
export function selectJobStore(): GenerationJobStore {
  return useRedisBackend()
    ? new RedisGenerationJobStore(env.GENERATION_JOB_TTL_SEC)
    : new InMemoryGenerationJobStore(env.GENERATION_JOB_TTL_SEC);
}
