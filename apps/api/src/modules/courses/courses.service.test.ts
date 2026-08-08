import { describe, it, expect, beforeEach } from 'vitest';
import { createCoursesService, type CoursesService } from './courses.service';
import { InMemoryCourseProgressRepository } from './courses.repository';

let service: CoursesService;

beforeEach(() => {
  service = createCoursesService({ progress: new InMemoryCourseProgressRepository() });
});

describe('the seeded curriculum', () => {
  it('ships Qaraami Oud Basics with Beerdilaacshe as Lesson 1', async () => {
    const courses = await service.listCourses('user-1');
    expect(courses).toHaveLength(1);
    expect(courses[0]).toMatchObject({
      id: 'qaraami-oud-basics',
      title: 'Qaraami Oud Basics',
      instrument: 'oud',
      lessonCount: 1,
      completedCount: 0,
    });

    const detail = await service.getCourse('user-1', 'qaraami-oud-basics');
    const first = detail.lessons[0];
    expect(first).toMatchObject({ id: 'beerdilaacshe', order: 1, completed: false });
    // The Beerdilaacshe lesson pattern: embedded PDF + engine-playable notes.
    expect(first?.pdfUrl).toBe('/scores/beerdilaacshe/Beerdilaacshe.pdf');
    expect(first?.notesUrl).toBe('/scores/beerdilaacshe/notes.json');
  });
});

describe('progress', () => {
  it('marks a lesson complete per user and reflects it in list + detail', async () => {
    await service.setLessonProgress('user-1', 'qaraami-oud-basics', 'beerdilaacshe', true);

    const mine = await service.getCourse('user-1', 'qaraami-oud-basics');
    expect(mine.completedCount).toBe(1);
    expect(mine.lessons[0]?.completed).toBe(true);

    // Another learner is untouched.
    const theirs = await service.getCourse('user-2', 'qaraami-oud-basics');
    expect(theirs.completedCount).toBe(0);

    // Un-complete works too.
    await service.setLessonProgress('user-1', 'qaraami-oud-basics', 'beerdilaacshe', false);
    const after = await service.listCourses('user-1');
    expect(after[0]?.completedCount).toBe(0);
  });

  it('rejects unknown courses and lessons', async () => {
    await expect(service.setLessonProgress('u', 'nope', 'x', true)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      service.setLessonProgress('u', 'qaraami-oud-basics', 'nope', true),
    ).rejects.toMatchObject({ code: 'LESSON_NOT_FOUND' });
  });
});
