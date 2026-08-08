/**
 * Courses service (Stage 4) — the authored curricula joined with the caller's
 * progress. Injected progress repository (ADR-0005) so it unit-tests with the
 * in-memory driver.
 */

import { notFound } from '@/shared/errors/AppError';
import {
  COURSES,
  courseProgressRepository,
  type Course,
  type CourseLesson,
  type CourseProgressRepository,
} from './courses.repository';

export interface CourseSummaryView {
  id: string;
  title: string;
  description: string;
  instrument: string;
  lessonCount: number;
  completedCount: number;
}

export interface CourseLessonView {
  id: string;
  title: string;
  description: string;
  order: number;
  mediaUrl: string | null;
  mediaKind: 'audio' | 'video' | null;
  pdfUrl: string | null;
  notesUrl: string | null;
  completed: boolean;
}

export interface CourseDetailView extends CourseSummaryView {
  lessons: CourseLessonView[];
}

function toLessonView(lesson: CourseLesson, completed: boolean): CourseLessonView {
  return {
    id: lesson.id,
    title: lesson.title,
    description: lesson.description,
    order: lesson.order,
    mediaUrl: lesson.media?.asset.url ?? null,
    mediaKind: lesson.media?.kind ?? null,
    pdfUrl: lesson.pdf?.url ?? null,
    notesUrl: lesson.notes?.url ?? null,
    completed,
  };
}

export function createCoursesService(deps: {
  progress: CourseProgressRepository;
  courses?: readonly Course[];
}) {
  const catalogue = deps.courses ?? COURSES;
  const { progress } = deps;

  async function listCourses(userId: string): Promise<CourseSummaryView[]> {
    const counts = await progress.completedCounts(
      userId,
      catalogue.map((c) => c.id),
    );
    return [...catalogue]
      .sort((a, b) => a.order - b.order)
      .map((course) => ({
        id: course.id,
        title: course.title,
        description: course.description,
        instrument: course.instrument,
        lessonCount: course.lessons.length,
        completedCount: Math.min(course.lessons.length, counts.get(course.id) ?? 0),
      }));
  }

  async function getCourse(userId: string, courseId: string): Promise<CourseDetailView> {
    const course = catalogue.find((c) => c.id === courseId);
    if (!course) throw notFound('NOT_FOUND', 'Course not found');
    const done = await progress.completedLessonIds(userId, courseId);
    const lessons = [...course.lessons]
      .sort((a, b) => a.order - b.order)
      .map((lesson) => toLessonView(lesson, done.has(lesson.id)));
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      instrument: course.instrument,
      lessonCount: lessons.length,
      completedCount: lessons.filter((l) => l.completed).length,
      lessons,
    };
  }

  async function setLessonProgress(
    userId: string,
    courseId: string,
    lessonId: string,
    completed: boolean,
  ): Promise<{ completed: boolean }> {
    const course = catalogue.find((c) => c.id === courseId);
    if (!course) throw notFound('NOT_FOUND', 'Course not found');
    if (!course.lessons.some((l) => l.id === lessonId)) {
      throw notFound('LESSON_NOT_FOUND', 'Lesson not found in this course');
    }
    await progress.setCompleted(userId, courseId, lessonId, completed);
    return { completed };
  }

  return { listCourses, getCourse, setLessonProgress };
}

export type CoursesService = ReturnType<typeof createCoursesService>;

export const coursesService: CoursesService = createCoursesService({
  progress: courseProgressRepository,
});
