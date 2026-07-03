/**
 * Lesson controllers (ARCHITECTURE.md §12 LESSONS). Thin adapters over the service.
 */

import type { Request, Response } from 'express';
import type { LessonProgressInput } from '@sma/validators';
import { sendSuccess } from '@/shared/http/respond';
import { unauthorized } from '@/shared/errors/AppError';
import { lessonsService } from './lessons.service';

export async function getModules(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await lessonsService.listModules());
}

export async function getModule(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await lessonsService.getModule(req.params['id'] ?? ''));
}

export async function getLesson(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await lessonsService.getLesson(req.params['id'] ?? ''));
}

export async function getProgress(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  sendSuccess(res, await lessonsService.listProgress(req.user.id));
}

export async function postProgress(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  const progress = await lessonsService.recordProgress(
    req.user.id,
    req.params['id'] ?? '',
    req.body as LessonProgressInput,
  );
  sendSuccess(res, progress);
}
