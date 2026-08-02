/**
 * AI music-generation input schemas (POST /api/v1/generate).
 *
 * The single validation gate for generation requests on server and clients
 * (CLAUDE.md hard rule: Zod on every API input). Field limits are the
 * intersection of what every provider accepts, so a request that validates
 * here can be routed to ANY provider: prompt ≤500 chars is Suno's non-custom
 * ceiling (Lyria takes far more), durationSec 5–180 spans Lyria clips (30s)
 * through Suno full tracks (the provider clamps to its own true limits).
 */

import { z } from 'zod';
import { MUSIC_PROVIDERS } from '@sma/constants';
import { uuidSchema } from './common';

export const musicProviderSchema = z.enum(MUSIC_PROVIDERS);

/** Strip ASCII control characters a terminal/log/provider should never see. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

const promptSchema = z
  .string()
  .transform((s) => s.replace(CONTROL_CHARS, ' ').trim())
  .pipe(
    z
      .string()
      .min(3, 'Describe the music in at least 3 characters')
      .max(500, 'Keep the description under 500 characters'),
  );

export const generateRequestSchema = z.object({
  provider: musicProviderSchema,
  prompt: promptSchema,
  /** Target length in seconds; each provider clamps to its own real range. */
  durationSec: z.number().int().min(5).max(180).optional(),
  instrumental: z.boolean().default(false),
  title: z.string().trim().max(80, 'Title is too long').optional(),
  /** Provider-specific model override (advanced; e.g. a Lyria model id). */
  model: z.string().trim().max(60).optional(),
});

export type GenerateRequestInput = z.infer<typeof generateRequestSchema>;

/** Route params for GET /generate/:jobId — job ids are server-issued UUIDs. */
export const generationJobParamsSchema = z.object({
  jobId: uuidSchema,
});

/**
 * The Suno reseller's completion webhook (POST /generate/callback). The payload
 * is DELIBERATELY accepted as unknown and then ignored: the endpoint exists only
 * because the reseller requires a callBackUrl, while job results are always
 * fetched by authenticated poll-through (the callback cannot be authenticated,
 * so nothing it says is ever trusted or stored). z.unknown() still satisfies
 * the Zod-on-every-input rule by making that decision explicit and visible.
 */
export const generationCallbackSchema = z.unknown();
