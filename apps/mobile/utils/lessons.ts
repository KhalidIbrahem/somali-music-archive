/**
 * Pure helpers for the Learn tab: compute a module's completion from the learner's
 * progress, and group modules by track. Kept dependency-free and unit-tested.
 */

import type { LessonModule, LessonProgress, LessonTrack } from '@sma/types';

export interface ModuleProgress {
  completed: number;
  total: number;
  /** 0–100, rounded. */
  pct: number;
}

/** Completion of a module = its completed lessons ÷ total lessons. */
export function computeModuleProgress(
  module: LessonModule,
  progress: readonly LessonProgress[],
): ModuleProgress {
  const completedLessons = new Set(
    progress.filter((p) => p.moduleId === module.id && p.completed).map((p) => p.lessonId),
  );
  const completed = module.lessonIds.filter((id) => completedLessons.has(id)).length;
  const total = module.lessonCount;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { completed, total, pct };
}

/** Modules the learner has started but not finished — the "Continue" section. */
export function inProgressModules(
  modules: readonly LessonModule[],
  progress: readonly LessonProgress[],
): LessonModule[] {
  return modules.filter((m) => {
    const { pct } = computeModuleProgress(m, progress);
    return pct > 0 && pct < 100;
  });
}

export const TRACK_ORDER: readonly LessonTrack[] = ['beginner', 'intermediate', 'advanced'];

export const TRACK_LABELS: Record<LessonTrack, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

/** Group modules by track in the canonical track order. */
export function groupModulesByTrack(
  modules: readonly LessonModule[],
): { track: LessonTrack; modules: LessonModule[] }[] {
  return TRACK_ORDER.map((track) => ({
    track,
    modules: modules.filter((m) => m.track === track).sort((a, b) => a.order - b.order),
  })).filter((group) => group.modules.length > 0);
}
