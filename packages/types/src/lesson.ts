/**
 * Lesson & learning-progress types (ARCHITECTURE.md §7 "Learn tab", §9 progress table).
 *
 * Lesson *content* is authored and lives in MongoDB / a CMS; learner *progress*
 * is relational and lives in PostgreSQL (`lesson_progress`). These two concerns
 * are modelled separately below and joined at read time.
 */

import type { Uuid, IsoDateTimeString } from './common';

/** Curriculum track a module belongs to. */
export type LessonTrack = 'beginner' | 'intermediate' | 'advanced';

/** A block of rich lesson content. Kept as a discriminated union so new block
 * types (video, quiz, …) can be appended without breaking existing renderers. */
export type LessonBlock =
  | { readonly kind: 'text'; readonly markdown: string }
  | { readonly kind: 'audio'; readonly recordingId: string; readonly caption?: string }
  | { readonly kind: 'pitch-exercise'; readonly targetNote: string; readonly targetHz: number };

export interface Lesson {
  readonly id: string;
  readonly moduleId: string;
  readonly title: string;
  /** 1-based ordering within the module. */
  readonly order: number;
  readonly blocks: readonly LessonBlock[];
  /** Estimated time to complete, minutes — for UI planning. */
  readonly estimatedMinutes?: number;
}

export interface LessonModule {
  readonly id: string;
  readonly track: LessonTrack;
  readonly title: string;
  readonly description?: string;
  readonly order: number;
  /** Ordered lesson ids; full lessons are fetched separately for a module screen. */
  readonly lessonIds: readonly string[];
  readonly lessonCount: number;
}

/** A learner's progress on a single lesson (`lesson_progress` row). */
export interface LessonProgress {
  readonly id: Uuid;
  readonly userId: Uuid;
  readonly lessonId: string;
  readonly moduleId: string;
  readonly completed: boolean;
  readonly completedAt?: IsoDateTimeString;
  /** 0–100. */
  readonly progressPct: number;
  /** Resume position within lesson audio, seconds. */
  readonly lastPositionSec: number;
  readonly updatedAt: IsoDateTimeString;
}
