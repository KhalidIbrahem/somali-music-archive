/**
 * Comment controllers (SESSION P4-05, ARCHITECTURE.md §16 Phase 4).
 */

import type { Request, Response } from 'express';
import type { CommentsQueryInput, CreateCommentInput } from '@sma/validators';
import { sendSuccess } from '@/shared/http/respond';
import { unauthorized } from '@/shared/errors/AppError';
import { commentsService } from './comments.service';

export async function create(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  const comment = await commentsService.createComment(req.user.id, req.body as CreateCommentInput);
  sendSuccess(res, comment, 201);
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as CommentsQueryInput;
  sendSuccess(res, await commentsService.listComments(query));
}

export async function remove(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  await commentsService.deleteComment(req.user.id, req.user.role, req.params['id'] ?? '');
  sendSuccess(res, { deleted: true });
}
