import { describe, it, expect, beforeEach } from 'vitest';
import { AppError } from '@/shared/errors/AppError';
import { InMemoryLessonRepository } from './lessons.repository';
import { createLessonsService, type LessonsService } from './lessons.service';

let service: LessonsService;
beforeEach(() => {
  service = createLessonsService(new InMemoryLessonRepository());
});

describe('lessons.service', () => {
  it('lists the seeded modules ordered by track', async () => {
    const modules = await service.listModules();
    expect(modules.length).toBeGreaterThanOrEqual(3);
    expect(modules.map((m) => m.track)).toEqual(['beginner', 'intermediate', 'advanced']);
    expect(modules[0]?.lessonCount).toBeGreaterThan(0);
  });

  it('returns a module with its ordered lessons', async () => {
    const module = await service.getModule('m-pentatonic');
    expect(module.title).toContain('Pentatonic');
    expect(module.lessons).toHaveLength(module.lessonCount);
    expect(module.lessons[0]?.order).toBe(1);
  });

  it('throws for an unknown module', async () => {
    await expect(service.getModule('nope')).rejects.toBeInstanceOf(AppError);
  });

  it('records progress and derives the module id + completion from the lesson', async () => {
    const progress = await service.recordProgress('user-1', 'l-pentatonic-1', {
      progressPct: 100,
      lastPositionSec: 42,
    });
    expect(progress.moduleId).toBe('m-pentatonic');
    expect(progress.completed).toBe(true);
    expect(progress.completedAt).toBeDefined();

    const all = await service.listProgress('user-1');
    expect(all).toHaveLength(1);
  });

  it('upserts progress for the same lesson (no duplicate rows)', async () => {
    await service.recordProgress('user-1', 'l-pentatonic-1', {
      progressPct: 30,
      lastPositionSec: 10,
    });
    await service.recordProgress('user-1', 'l-pentatonic-1', {
      progressPct: 60,
      lastPositionSec: 20,
    });
    const all = await service.listProgress('user-1');
    expect(all).toHaveLength(1);
    expect(all[0]?.progressPct).toBe(60);
    expect(all[0]?.completed).toBe(false);
  });

  it('rejects progress for an unknown lesson', async () => {
    await expect(
      service.recordProgress('user-1', 'nope', { progressPct: 10, lastPositionSec: 0 }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
