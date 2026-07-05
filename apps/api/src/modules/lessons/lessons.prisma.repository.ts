/**
 * Lesson persistence with Postgres progress (SESSION "db-backed repositories",
 * ARCHITECTURE.md §9 lesson_progress).
 *
 * Lesson *content* is authored and ships in code (lessons.repository.ts), so this
 * repository serves it from the shared content helpers; only per-user *progress*
 * is persisted, in the `lesson_progress` table. Binds in place of the in-memory
 * version when PERSISTENCE=database.
 */

import type { PrismaClient, LessonProgress as LessonProgressRow } from '@prisma/client';
import type { Lesson, LessonModule, LessonProgress, ModuleWithLessons } from '@sma/types';
import type { LessonProgressInput } from '@sma/validators';
import { asIso, asUuid } from '@/shared/brand';
import {
  getLessonContent,
  getModuleContent,
  listModulesContent,
  type LessonRepository,
} from './lessons.repository';

function toLessonProgress(row: LessonProgressRow): LessonProgress {
  return {
    id: asUuid(row.id),
    userId: asUuid(row.userId),
    lessonId: row.lessonId,
    moduleId: row.moduleId,
    completed: row.completed,
    progressPct: row.progressPct,
    lastPositionSec: row.lastPositionSec,
    updatedAt: asIso(row.updatedAt),
    ...(row.completedAt ? { completedAt: asIso(row.completedAt) } : {}),
  };
}

export class PrismaLessonRepository implements LessonRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // Content is authored, served from the shared in-code curriculum.
  async listModules(): Promise<LessonModule[]> {
    return listModulesContent();
  }

  async getModule(id: string): Promise<ModuleWithLessons | null> {
    return getModuleContent(id);
  }

  async getLesson(id: string): Promise<Lesson | null> {
    return getLessonContent(id);
  }

  async listProgress(userId: string): Promise<LessonProgress[]> {
    const rows = await this.prisma.lessonProgress.findMany({ where: { userId } });
    return rows.map(toLessonProgress);
  }

  async upsertProgress(
    userId: string,
    lessonId: string,
    moduleId: string,
    input: LessonProgressInput,
  ): Promise<LessonProgress> {
    const completed = input.completed ?? input.progressPct === 100;
    const completedAt = completed ? { completedAt: new Date() } : {};
    const row = await this.prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      create: {
        userId,
        lessonId,
        moduleId,
        completed,
        progressPct: input.progressPct,
        lastPositionSec: input.lastPositionSec,
        ...completedAt,
      },
      update: {
        moduleId,
        completed,
        progressPct: input.progressPct,
        lastPositionSec: input.lastPositionSec,
        ...completedAt,
      },
    });
    return toLessonProgress(row);
  }
}
