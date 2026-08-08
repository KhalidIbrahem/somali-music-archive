/**
 * Education controllers — thin adapters over `educationService` (§8 upload flow).
 */

import type { Request, Response } from 'express';
import type {
  LessonCreateInput,
  LessonUpdateInput,
  LessonUploadUrlRequestInput,
} from '@sma/validators';
import { sendSuccess } from '@/shared/http/respond';
import { unauthorized } from '@/shared/errors/AppError';
import { educationService, type EducationActor } from './education.service';

/** The authenticated principal, or null on public routes without a token. */
function viewerOf(req: Request): EducationActor | null {
  return req.user ? { id: req.user.id, role: req.user.role } : null;
}

function actorOf(req: Request): EducationActor {
  if (!req.user) throw unauthorized();
  return { id: req.user.id, role: req.user.role };
}

export async function createUploadUrl(req: Request, res: Response): Promise<void> {
  const result = await educationService.createUploadUrl(req.body as LessonUploadUrlRequestInput);
  sendSuccess(res, result, 201);
}

export async function createLesson(req: Request, res: Response): Promise<void> {
  const lesson = await educationService.createLesson(req.body as LessonCreateInput, actorOf(req));
  sendSuccess(res, lesson, 201);
}

export async function listLessons(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await educationService.listPublished());
}

export async function listMine(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await educationService.listMine(actorOf(req)));
}

export async function getLesson(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await educationService.getLesson(req.params['id'] ?? '', viewerOf(req)));
}

export async function updateLesson(req: Request, res: Response): Promise<void> {
  const lesson = await educationService.updateLesson(
    req.params['id'] ?? '',
    req.body as LessonUpdateInput,
    actorOf(req),
  );
  sendSuccess(res, lesson);
}

export async function deleteLesson(req: Request, res: Response): Promise<void> {
  await educationService.deleteLesson(req.params['id'] ?? '', actorOf(req));
  sendSuccess(res, { deleted: true });
}

export async function getAttachmentUrl(req: Request, res: Response): Promise<void> {
  const key = typeof req.query['key'] === 'string' ? req.query['key'] : '';
  sendSuccess(
    res,
    await educationService.getAttachmentUrl(req.params['id'] ?? '', key, viewerOf(req)),
  );
}
