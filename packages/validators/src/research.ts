/**
 * Research API input schemas (ARCHITECTURE.md §12 RESEARCH, SESSION P3-07).
 *
 * The single source of truth (ADR-0007) for the key-creation body and the dataset
 * query, used by the API's `validate()` middleware.
 */

import { z } from 'zod';
import { genreSchema, paginationQuerySchema } from './common';

/** Access tiers a key can be issued under. */
export const API_KEY_PLANS = ['academic', 'commercial'] as const;

/** POST /research/keys — create a research API key for the signed-in user. */
export const createApiKeySchema = z.object({
  name: z.string().trim().min(1, 'A name is required').max(80),
  plan: z.enum(API_KEY_PLANS).default('academic'),
  /** Optional expiry; omitted = never expires. */
  expiresInDays: z.coerce.number().int().positive().max(3650).optional(),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

/** GET /research/dataset — paginated corpus export, optional genre facet. */
export const researchDatasetQuerySchema = paginationQuerySchema.extend({
  genre: genreSchema.optional(),
  /** Include the (large) per-frame pitch track. Query string → boolean. */
  includePitch: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
export type ResearchDatasetQueryInput = z.output<typeof researchDatasetQuerySchema>;
