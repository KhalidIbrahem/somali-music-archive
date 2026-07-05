import {
  computeModuleProgress,
  inProgressModules,
  groupModulesByTrack,
  isQuizCorrect,
  quizOptionState,
} from './lessons';
import type { LessonBlock, LessonModule, LessonProgress } from '@sma/types';

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

// ── Quiz block (SESSION P4-04) ───────────────────────────────────────────────

const quiz: Extract<LessonBlock, { kind: 'quiz' }> = {
  kind: 'quiz',
  prompt: 'How many notes are in the Somali pentatonic scale?',
  options: ['Four', 'Five', 'Seven'],
  answerIndex: 1,
};

describe('isQuizCorrect', () => {
  it('is true only for the answer index', () => {
    expect(isQuizCorrect(quiz, 1)).toBe(true);
    expect(isQuizCorrect(quiz, 0)).toBe(false);
    expect(isQuizCorrect(quiz, 2)).toBe(false);
  });
});

describe('quizOptionState', () => {
  it('is idle for every option before an answer', () => {
    expect(quizOptionState(quiz, null, 0)).toBe('idle');
    expect(quizOptionState(quiz, null, 1)).toBe('idle');
  });

  it('reveals the correct answer and marks the wrong pick', () => {
    // Picked option 0 (wrong): 0 is incorrect, 1 is revealed correct, 2 stays idle.
    expect(quizOptionState(quiz, 0, 0)).toBe('incorrect');
    expect(quizOptionState(quiz, 0, 1)).toBe('correct');
    expect(quizOptionState(quiz, 0, 2)).toBe('idle');
  });

  it('marks the correct pick correct', () => {
    expect(quizOptionState(quiz, 1, 1)).toBe('correct');
  });
});
