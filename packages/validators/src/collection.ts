/**
 * Collection input schemas (ARCHITECTURE.md §16 Phase 4, SESSION P4-05).
 */

import { z } from 'zod';

/** POST /collections — create a curated list. */
export const createCollectionSchema = z.object({
  name: z.string().trim().min(1, 'A name is required').max(120),
  description: z.string().trim().max(2000).optional(),
  isPublic: z.boolean().optional().default(false),
});
export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;

/** POST /collections/:id/items — add a recording to a collection. */
export const addCollectionItemSchema = z.object({
  recordingId: z.string().trim().min(1).max(64),
});
export type AddCollectionItemInput = z.infer<typeof addCollectionItemSchema>;
