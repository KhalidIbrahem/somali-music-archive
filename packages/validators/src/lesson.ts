/**
 * Lesson progress input schema (ARCHITECTURE.md §12 LESSONS, §9 lesson_progress).
 */

import { z } from 'zod';

/** POST /lessons/:id/progress — a learner reporting how far they got. */
export const lessonProgressSchema = z
  .object({
    progressPct: z.coerce.number().int().min(0).max(100),
    lastPositionSec: z.coerce.number().int().min(0).default(0),
    completed: z.boolean().optional(),
  })
  // Reaching 100% and being marked complete must agree — reject contradictions.
  .refine((d) => !(d.completed === false && d.progressPct === 100), {
    message: 'A 100% lesson cannot be marked incomplete',
    path: ['completed'],
  });

export type LessonProgressInput = z.infer<typeof lessonProgressSchema>;
