import { computeModuleProgress, inProgressModules, groupModulesByTrack } from './lessons';
import type { LessonModule, LessonProgress } from '@sma/types';

const mod = (
  id: string,
  track: LessonModule['track'],
  lessonIds: string[],
  order = 1,
): LessonModule => ({
  id,
  track,
  title: id,
  order,
  lessonIds,
  lessonCount: lessonIds.length,
});

const done = (moduleId: string, lessonId: string): LessonProgress =>
  ({ moduleId, lessonId, completed: true, progressPct: 100 }) as unknown as LessonProgress;

describe('computeModuleProgress', () => {
  const m = mod('m1', 'beginner', ['a', 'b', 'c', 'd']);

  it('is 0% with no progress', () => {
    expect(computeModuleProgress(m, [])).toEqual({ completed: 0, total: 4, pct: 0 });
  });

  it('counts only completed lessons that belong to the module', () => {
    const result = computeModuleProgress(m, [done('m1', 'a'), done('m1', 'b'), done('other', 'x')]);
    expect(result).toEqual({ completed: 2, total: 4, pct: 50 });
  });

  it('rounds the percentage', () => {
    expect(computeModuleProgress(m, [done('m1', 'a')]).pct).toBe(25);
  });
});

describe('inProgressModules', () => {
  it('returns only started-but-not-finished modules', () => {
    const started = mod('m1', 'beginner', ['a', 'b']);
    const finished = mod('m2', 'beginner', ['c']);
    const untouched = mod('m3', 'beginner', ['d']);
    const progress = [done('m1', 'a'), done('m2', 'c')];
    const result = inProgressModules([started, finished, untouched], progress);
    expect(result.map((m) => m.id)).toEqual(['m1']);
  });
});

describe('groupModulesByTrack', () => {
  it('groups in canonical track order and drops empty tracks', () => {
    const groups = groupModulesByTrack([
      mod('adv', 'advanced', ['x']),
      mod('beg', 'beginner', ['y']),
    ]);
    expect(groups.map((g) => g.track)).toEqual(['beginner', 'advanced']);
  });
});
