/**
 * Lesson API calls (ARCHITECTURE.md §12 LESSONS).
 */

import type {
  ApiResponse,
  Lesson,
  LessonModule,
  LessonProgress,
  ModuleWithLessons,
} from '@sma/types';
import type { LessonProgressInput } from '@sma/validators';
import { apiClient } from './client';
import { unwrap } from './unwrap';

export async function getModules(): Promise<LessonModule[]> {
  const res = await apiClient.get<ApiResponse<LessonModule[]>>('/lessons/modules');
  return unwrap(res.data);
}

export async function getModule(id: string): Promise<ModuleWithLessons> {
  const res = await apiClient.get<ApiResponse<ModuleWithLessons>>(`/lessons/modules/${id}`);
  return unwrap(res.data);
}

export async function getLesson(id: string): Promise<Lesson> {
  const res = await apiClient.get<ApiResponse<Lesson>>(`/lessons/${id}`);
  return unwrap(res.data);
}

export async function getMyProgress(): Promise<LessonProgress[]> {
  const res = await apiClient.get<ApiResponse<LessonProgress[]>>('/lessons/progress');
  return unwrap(res.data);
}

export async function updateProgress(
  lessonId: string,
  input: LessonProgressInput,
): Promise<LessonProgress> {
  const res = await apiClient.post<ApiResponse<LessonProgress>>(
    `/lessons/${lessonId}/progress`,
    input,
  );
  return unwrap(res.data);
}
