/**
 * Lesson content + progress persistence (ARCHITECTURE.md §7 Learn, §9 lesson_progress).
 *
 * Lesson content is authored, so Phase 1 ships it as a seeded, in-memory curriculum
 * (the three tracks from §7). Phase 2 moves content to MongoDB/a CMS and progress to
 * PostgreSQL behind this same interface (ADR-0005). Progress is per-user, in-memory.
 */

import type { Lesson, LessonModule, LessonProgress, ModuleWithLessons } from '@sma/types';
import type { LessonProgressInput } from '@sma/validators';
import { asIso, asUuid } from '@/shared/brand';
import { randomUUID } from '@/shared/crypto';

// ── Seed curriculum (ARCHITECTURE.md §7 tracks) ───────────────────────────────

const LESSONS: readonly Lesson[] = [
  // Beginner — Understanding Somali Music
  {
    id: 'l-understanding-1',
    moduleId: 'm-understanding',
    title: 'What Is Somali Music?',
    order: 1,
    estimatedMinutes: 6,
    blocks: [
      {
        kind: 'text',
        markdown:
          'Somali music is a living oral tradition — heello, qaraami, dhaanto, buraanbur, gabay. This lesson introduces the landscape you will explore.',
      },
    ],
  },
  {
    id: 'l-understanding-2',
    moduleId: 'm-understanding',
    title: 'The Oral Tradition',
    order: 2,
    estimatedMinutes: 8,
    blocks: [
      {
        kind: 'text',
        markdown:
          'Without written scores, Somali music passed from voice to voice. Learn why preservation is urgent — and what is lost when an elder passes.',
      },
    ],
  },
  {
    id: 'l-understanding-3',
    moduleId: 'm-understanding',
    title: 'Instruments of the Tradition',
    order: 3,
    estimatedMinutes: 7,
    blocks: [
      {
        kind: 'text',
        markdown:
          'Meet the oud (kaban), the shareero, the durbaan, and the central instrument: the voice.',
      },
    ],
  },
  // Intermediate — The Pentatonic Scale & Oud Basics
  {
    id: 'l-pentatonic-1',
    moduleId: 'm-pentatonic',
    title: 'The Five Notes',
    order: 1,
    estimatedMinutes: 10,
    blocks: [
      {
        kind: 'text',
        markdown: 'The Somali pentatonic scale: do, re, mi, sol, la. Hear each degree.',
      },
      { kind: 'pitch-exercise', targetNote: 'do', targetHz: 293.66 },
    ],
  },
  {
    id: 'l-pentatonic-2',
    moduleId: 'm-pentatonic',
    title: 'Tuning the Oud',
    order: 2,
    estimatedMinutes: 9,
    blocks: [
      { kind: 'text', markdown: 'How the oud is tuned for Somali repertoire, and why it matters.' },
    ],
  },
  {
    id: 'l-pentatonic-3',
    moduleId: 'm-pentatonic',
    title: 'Microtonality & Cents',
    order: 3,
    estimatedMinutes: 12,
    blocks: [
      {
        kind: 'text',
        markdown:
          'The expressive "in-between" pitches that Western notation misses — measured in cents. This is the research heart of the archive.',
      },
      { kind: 'pitch-exercise', targetNote: 'mi', targetHz: 369.99 },
    ],
  },
  // Advanced — Song-specific learning
  {
    id: 'l-song-1',
    moduleId: 'm-song',
    title: 'Anatomy of a Qaraami',
    order: 1,
    estimatedMinutes: 14,
    blocks: [
      {
        kind: 'text',
        markdown: 'Break down a classic qaraami: melody, poetry, and accompaniment.',
      },
    ],
  },
  {
    id: 'l-song-2',
    moduleId: 'm-song',
    title: 'Buraanbur Metre',
    order: 2,
    estimatedMinutes: 11,
    blocks: [
      {
        kind: 'text',
        markdown: "The distinctive metre of women's buraanbur, performed at celebrations.",
      },
    ],
  },
];

function lessonsFor(moduleId: string): Lesson[] {
  return LESSONS.filter((l) => l.moduleId === moduleId).sort((a, b) => a.order - b.order);
}

function buildModule(
  id: string,
  track: LessonModule['track'],
  title: string,
  description: string,
  order: number,
): LessonModule {
  const lessons = lessonsFor(id);
  return {
    id,
    track,
    title,
    description,
    order,
    lessonIds: lessons.map((l) => l.id),
    lessonCount: lessons.length,
  };
}

const MODULES: readonly LessonModule[] = [
  buildModule(
    'm-understanding',
    'beginner',
    'Understanding Somali Music',
    'Where the tradition comes from.',
    1,
  ),
  buildModule(
    'm-pentatonic',
    'intermediate',
    'The Pentatonic Scale & Oud Basics',
    'The five notes and the oud.',
    2,
  ),
  buildModule(
    'm-song',
    'advanced',
    'Song-Specific Learning',
    'Study individual songs in depth.',
    3,
  ),
];

// ── Repository ────────────────────────────────────────────────────────────────

export interface LessonRepository {
  listModules(): Promise<LessonModule[]>;
  getModule(id: string): Promise<ModuleWithLessons | null>;
  getLesson(id: string): Promise<Lesson | null>;
  listProgress(userId: string): Promise<LessonProgress[]>;
  upsertProgress(
    userId: string,
    lessonId: string,
    moduleId: string,
    input: LessonProgressInput,
  ): Promise<LessonProgress>;
}

export class InMemoryLessonRepository implements LessonRepository {
  /** userId → (lessonId → progress). */
  private readonly progress = new Map<string, Map<string, LessonProgress>>();

  async listModules(): Promise<LessonModule[]> {
    return [...MODULES].sort((a, b) => a.order - b.order);
  }

  async getModule(id: string): Promise<ModuleWithLessons | null> {
    const module = MODULES.find((m) => m.id === id);
    return module ? { ...module, lessons: lessonsFor(id) } : null;
  }

  async getLesson(id: string): Promise<Lesson | null> {
    return LESSONS.find((l) => l.id === id) ?? null;
  }

  async listProgress(userId: string): Promise<LessonProgress[]> {
    return [...(this.progress.get(userId)?.values() ?? [])];
  }

  async upsertProgress(
    userId: string,
    lessonId: string,
    moduleId: string,
    input: LessonProgressInput,
  ): Promise<LessonProgress> {
    let forUser = this.progress.get(userId);
    if (!forUser) {
      forUser = new Map();
      this.progress.set(userId, forUser);
    }
    const existing = forUser.get(lessonId);
    const completed = input.completed ?? input.progressPct === 100;
    const now = new Date();
    const record: LessonProgress = {
      id: existing?.id ?? asUuid(randomUUID()),
      userId: asUuid(userId),
      lessonId,
      moduleId,
      completed,
      progressPct: input.progressPct,
      lastPositionSec: input.lastPositionSec,
      updatedAt: asIso(now),
      ...(completed ? { completedAt: asIso(now) } : {}),
    };
    forUser.set(lessonId, record);
    return record;
  }
}

export const lessonRepository: LessonRepository = new InMemoryLessonRepository();
