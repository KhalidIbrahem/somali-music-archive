/**
 * Community comment input schemas (ARCHITECTURE.md §16 Phase 4, SESSION P4-05).
 */

import { z } from 'zod';
import { paginationQuerySchema } from './common';

/** POST /comments — leave a comment on a recording. */
export const createCommentSchema = z.object({
  recordingId: z.string().trim().min(1).max(64),
  body: z.string().trim().min(1, 'Comment cannot be empty').max(2000),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

/** GET /comments?recordingId=&page=&limit= — a recording's comment thread. */
export const commentsQuerySchema = paginationQuerySchema.extend({
  recordingId: z.string().trim().min(1).max(64),
});
export type CommentsQueryInput = z.output<typeof commentsQuerySchema>;
