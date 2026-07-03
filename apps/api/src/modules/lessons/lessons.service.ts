/**
 * Lessons service (ARCHITECTURE.md §7 Learn, §12 LESSONS).
 *
 * Reads the seeded curriculum and records per-user progress. Injected repository
 * (ADR-0005) so it is unit-testable without a database.
 */

import type { Lesson, LessonModule, LessonProgress, ModuleWithLessons } from '@sma/types';
import type { LessonProgressInput } from '@sma/validators';
import { notFound } from '@/shared/errors/AppError';
import { lessonRepository, type LessonRepository } from './lessons.repository';

export function createLessonsService(repo: LessonRepository) {
  async function listModules(): Promise<LessonModule[]> {
    return repo.listModules();
  }

  async function getModule(id: string): Promise<ModuleWithLessons> {
    const module = await repo.getModule(id);
    if (!module) throw notFound('LESSON_NOT_FOUND', 'Module not found');
    return module;
  }

  async function getLesson(id: string): Promise<Lesson> {
    const lesson = await repo.getLesson(id);
    if (!lesson) throw notFound('LESSON_NOT_FOUND', 'Lesson not found');
    return lesson;
  }

  async function listProgress(userId: string): Promise<LessonProgress[]> {
    return repo.listProgress(userId);
  }

  async function recordProgress(
    userId: string,
    lessonId: string,
    input: LessonProgressInput,
  ): Promise<LessonProgress> {
    const lesson = await repo.getLesson(lessonId);
    if (!lesson) throw notFound('LESSON_NOT_FOUND', 'Lesson not found');
    return repo.upsertProgress(userId, lessonId, lesson.moduleId, input);
  }

  return { listModules, getModule, getLesson, listProgress, recordProgress };
}

export type LessonsService = ReturnType<typeof createLessonsService>;

export const lessonsService: LessonsService = createLessonsService(lessonRepository);
