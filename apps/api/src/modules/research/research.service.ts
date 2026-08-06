/**
 * Research service (ARCHITECTURE.md §12 RESEARCH, SESSION P3-07).
 *
 * Owns research API keys and the dataset export. Keys are `sma_`-prefixed random
 * secrets, returned in plaintext exactly once and stored only as a bcrypt hash
 * (reusing the password hasher — CONVENTIONS.md bcrypt-12 rule). Verification narrows by
 * the stored prefix, then bcrypt-compares, so a database leak yields no usable keys.
 * The export reuses the recordings repository (published archive only) and projects
 * each recording to the research view — the pitch track is opt-in because it is large.
 *
 * Injected repositories (ADR-0005) so every branch is unit-testable in-memory.
 */

import { randomBytes } from 'node:crypto';
import type {
  ApiKeyPlan,
  CreatedApiKey,
  Paginated,
  PublicApiKey,
  PublicRecording,
  ResearchRecording,
} from '@sma/types';
import type { CreateApiKeyInput, ResearchDatasetQueryInput } from '@sma/validators';
import { asIso, asUuid } from '@/shared/brand';
import { hashPassword, verifyPassword } from '@/modules/auth/password.service';
import {
  recordingRepository,
  type RecordingRepository,
} from '@/modules/recordings/recordings.repository';
import { apiKeyRepository, type ApiKeyRecord, type ApiKeyRepository } from './apiKey.repository';

/** Key scheme + the prefix length stored for lookup (`sma_` + 8 random chars). */
const KEY_SCHEME = 'sma_';
const PREFIX_LENGTH = KEY_SCHEME.length + 8;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Default hourly request budget per plan. */
const PLAN_RATE_LIMIT: Record<ApiKeyPlan, number> = {
  academic: 1000,
  commercial: 10000,
};

/** A `sma_`-prefixed key and the prefix persisted alongside its hash. */
function generateApiKey(): { key: string; prefix: string } {
  const key = `${KEY_SCHEME}${randomBytes(24).toString('base64url')}`;
  return { key, prefix: key.slice(0, PREFIX_LENGTH) };
}

function toPublicApiKey(record: ApiKeyRecord): PublicApiKey {
  return {
    id: asUuid(record.id),
    name: record.name,
    keyPrefix: record.keyPrefix,
    plan: record.plan,
    rateLimit: record.rateLimit,
    createdAt: asIso(record.createdAt),
    ...(record.lastUsedAt ? { lastUsedAt: asIso(record.lastUsedAt) } : {}),
    ...(record.expiresAt ? { expiresAt: asIso(record.expiresAt) } : {}),
  };
}

/** Project a published recording to the research export shape. */
function toResearchRecording(r: PublicRecording, includePitch: boolean): ResearchRecording {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist.name,
    genre: r.genre,
    instruments: r.instruments,
    language: r.language,
    durationSec: r.duration,
    createdAt: r.createdAt,
    ai: {
      ...(r.ai.transcriptSomali !== undefined ? { transcriptSomali: r.ai.transcriptSomali } : {}),
      ...(r.ai.transcriptEnglish !== undefined
        ? { transcriptEnglish: r.ai.transcriptEnglish }
        : {}),
      ...(r.ai.isSinging !== undefined ? { isSinging: r.ai.isSinging } : {}),
      ...(r.ai.dominantNotes !== undefined ? { dominantNotes: r.ai.dominantNotes } : {}),
      ...(r.ai.voicedFraction !== undefined ? { voicedFraction: r.ai.voicedFraction } : {}),
      ...(includePitch && r.ai.pitchData !== undefined ? { pitch: r.ai.pitchData } : {}),
    },
    ...(r.region ? { region: r.region } : {}),
    ...(r.era ? { era: r.era } : {}),
  };
}

export interface ResearchServiceDeps {
  apiKeys: ApiKeyRepository;
  recordings: RecordingRepository;
}

export function createResearchService(deps: ResearchServiceDeps) {
  const { apiKeys, recordings } = deps;

  async function createApiKey(userId: string, input: CreateApiKeyInput): Promise<CreatedApiKey> {
    const { key, prefix } = generateApiKey();
    const record = await apiKeys.create({
      userId,
      keyHash: await hashPassword(key),
      keyPrefix: prefix,
      name: input.name,
      plan: input.plan,
      rateLimit: PLAN_RATE_LIMIT[input.plan],
      expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * DAY_MS) : null,
    });
    // The plaintext key is surfaced here and never again.
    return { ...toPublicApiKey(record), key };
  }

  /**
   * Resolve a presented key to its (active, unexpired) record, or null. Narrows by
   * prefix, then bcrypt-compares each candidate; touches lastUsedAt on a match.
   */
  async function verifyApiKey(presented: string): Promise<ApiKeyRecord | null> {
    if (!presented.startsWith(KEY_SCHEME) || presented.length <= PREFIX_LENGTH) return null;
    const candidates = await apiKeys.findActiveByPrefix(presented.slice(0, PREFIX_LENGTH));
    for (const candidate of candidates) {
      if (candidate.expiresAt && candidate.expiresAt.getTime() <= Date.now()) continue;
      if (await verifyPassword(presented, candidate.keyHash)) {
        await apiKeys.touchLastUsed(candidate.id);
        return candidate;
      }
    }
    return null;
  }

  async function listKeys(userId: string): Promise<PublicApiKey[]> {
    return (await apiKeys.listForUser(userId)).map(toPublicApiKey);
  }

  async function revokeKey(userId: string, id: string): Promise<boolean> {
    return apiKeys.revoke(id, userId);
  }

  async function exportDataset(
    query: ResearchDatasetQueryInput,
  ): Promise<Paginated<ResearchRecording>> {
    const page = await recordings.list({
      page: query.page,
      limit: query.limit,
      ...(query.genre ? { genre: query.genre } : {}),
    });
    return {
      ...page,
      data: page.data.map((r) => toResearchRecording(r, query.includePitch)),
    };
  }

  return { createApiKey, verifyApiKey, listKeys, revokeKey, exportDataset };
}

export type ResearchService = ReturnType<typeof createResearchService>;

export const researchService: ResearchService = createResearchService({
  apiKeys: apiKeyRepository,
  recordings: recordingRepository,
});
