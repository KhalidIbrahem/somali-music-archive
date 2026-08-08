/**
 * Courses (SESSION "studio master plan", Stage 4) — structured curricula:
 * course → ordered lessons, each with an optional media file and attached
 * sheet music (PDF + parsed note list the oud engine performs).
 *
 * Course CONTENT ships as authored code (same precedent as the built-in
 * lessons curriculum in lessons.repository.ts): deterministic, versioned in
 * git, identical in every environment. Only per-learner PROGRESS is stored —
 * in the existing PostgreSQL `lesson_progress` table (Prisma) keyed
 * (userId, lessonId) with the course id as moduleId; in-memory for dev/test.
 */

import { useDatabase } from '@/shared/db/driver';
import { getPrisma } from '@/shared/db/prisma';

/** Where a lesson asset lives. `static` = shipped under apps/web/public. */
export interface CourseAsset {
  kind: 'static';
  url: string;
}

export interface CourseLesson {
  id: string;
  title: string;
  description: string;
  order: number;
  media: { kind: 'audio' | 'video'; asset: CourseAsset } | null;
  /** Embedded sheet music (PDF) — the Beerdilaacshe pattern. */
  pdf: CourseAsset | null;
  /** Parsed note list the shared oud+durbaan engine performs in the browser. */
  notes: CourseAsset | null;
}

export interface Course {
  id: string;
  title: string;
  description: string;
  instrument: string;
  order: number;
  lessons: CourseLesson[];
}

/**
 * The seeded curriculum (master-plan brief: 'Seed with one course: "Qaraami
 * Oud Basics" — Lesson 1: Beerdilaacshe (Abdillahi Qarshe, 1950s)').
 */
export const COURSES: readonly Course[] = [
  {
    id: 'qaraami-oud-basics',
    title: 'Qaraami Oud Basics',
    description:
      'Learn the oud through the qaraami repertoire itself: each lesson is a real song from the golden age, with engraved sheet music you can read and a performance the studio plays for you, note by note.',
    instrument: 'oud',
    order: 1,
    lessons: [
      {
        id: 'beerdilaacshe',
        title: 'Lesson 1 — Beerdilaacshe',
        description:
          'The starting point of the songbook: Beerdilaacshe, composed by Abdillahi Qarshe in the 1950s. Read the engraved score while the studio performs it — a plucked oud voice over a durbaan groove at ♩ = 96 — then play along phrase by phrase. Sheet music by Khalid Ibrahim.',
        order: 1,
        media: null,
        pdf: { kind: 'static', url: '/scores/beerdilaacshe/Beerdilaacshe.pdf' },
        notes: { kind: 'static', url: '/scores/beerdilaacshe/notes.json' },
      },
    ],
  },
];

// ── Per-learner progress ──────────────────────────────────────────────────────

export interface CourseProgressRepository {
  /** Lesson ids the user has completed within one course. */
  completedLessonIds(userId: string, courseId: string): Promise<Set<string>>;
  /** Completed lesson counts for many courses at once (dashboard list). */
  completedCounts(userId: string, courseIds: readonly string[]): Promise<Map<string, number>>;
  setCompleted(
    userId: string,
    courseId: string,
    lessonId: string,
    completed: boolean,
  ): Promise<void>;
}

/** lesson_progress.moduleId namespace so course rows never collide with the
 * built-in curriculum's module ids. */
const moduleIdFor = (courseId: string): string => `course:${courseId}`;

export class InMemoryCourseProgressRepository implements CourseProgressRepository {
  /** `${userId}:${courseId}` → completed lesson ids. */
  private readonly completed = new Map<string, Set<string>>();

  private key(userId: string, courseId: string): string {
    return `${userId}:${courseId}`;
  }

  async completedLessonIds(userId: string, courseId: string): Promise<Set<string>> {
    return new Set(this.completed.get(this.key(userId, courseId)) ?? []);
  }

  async completedCounts(
    userId: string,
    courseIds: readonly string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const courseId of courseIds) {
      out.set(courseId, this.completed.get(this.key(userId, courseId))?.size ?? 0);
    }
    return out;
  }

  async setCompleted(
    userId: string,
    courseId: string,
    lessonId: string,
    completed: boolean,
  ): Promise<void> {
    const key = this.key(userId, courseId);
    let set = this.completed.get(key);
    if (!set) {
      set = new Set();
      this.completed.set(key, set);
    }
    if (completed) set.add(lessonId);
    else set.delete(lessonId);
  }
}

/** PostgreSQL implementation over the existing lesson_progress table. */
export class PrismaCourseProgressRepository implements CourseProgressRepository {
  async completedLessonIds(userId: string, courseId: string): Promise<Set<string>> {
    const rows = await getPrisma().lessonProgress.findMany({
      where: { userId, moduleId: moduleIdFor(courseId), completed: true },
      select: { lessonId: true },
    });
    return new Set(rows.map((r) => r.lessonId));
  }

  async completedCounts(
    userId: string,
    courseIds: readonly string[],
  ): Promise<Map<string, number>> {
    const rows = await getPrisma().lessonProgress.groupBy({
      by: ['moduleId'],
      where: { userId, completed: true, moduleId: { in: courseIds.map(moduleIdFor) } },
      _count: { lessonId: true },
    });
    const out = new Map<string, number>();
    for (const courseId of courseIds) out.set(courseId, 0);
    for (const row of rows) {
      out.set(row.moduleId.replace(/^course:/, ''), row._count.lessonId);
    }
    return out;
  }

  async setCompleted(
    userId: string,
    courseId: string,
    lessonId: string,
    completed: boolean,
  ): Promise<void> {
    await getPrisma().lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      create: {
        userId,
        lessonId,
        moduleId: moduleIdFor(courseId),
        completed,
        completedAt: completed ? new Date() : null,
        progressPct: completed ? 100 : 0,
      },
      update: {
        completed,
        completedAt: completed ? new Date() : null,
        progressPct: completed ? 100 : 0,
        moduleId: moduleIdFor(courseId),
      },
    });
  }
}

export const courseProgressRepository: CourseProgressRepository = useDatabase()
  ? new PrismaCourseProgressRepository()
  : new InMemoryCourseProgressRepository();
