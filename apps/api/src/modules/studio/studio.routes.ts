/**
 * Studio routes (/api/v1/studio) — DAW project sync, members only.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { studioProjectSaveSchema, type StudioProjectSaveInput } from '@sma/validators';
import { validate } from '@/shared/middleware/validate';
import { authenticate } from '@/shared/middleware/authenticate';
import { asyncHandler } from '@/shared/http/asyncHandler';
import { sendSuccess } from '@/shared/http/respond';
import { unauthorized } from '@/shared/errors/AppError';
import { studioService } from './studio.service';

export const studioRouter: Router = Router();

studioRouter.use(authenticate);

function userId(req: Request): string {
  if (!req.user) throw unauthorized();
  return req.user.id;
}

studioRouter.get(
  '/projects',
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await studioService.listProjects(userId(req)));
  }),
);

studioRouter.get(
  '/projects/:id',
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await studioService.getProject(userId(req), req.params['id'] ?? ''));
  }),
);

studioRouter.post(
  '/projects',
  validate({ body: studioProjectSaveSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await studioService.createProject(userId(req), req.body as StudioProjectSaveInput),
      201,
    );
  }),
);

studioRouter.put(
  '/projects/:id',
  validate({ body: studioProjectSaveSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await studioService.updateProject(
        userId(req),
        req.params['id'] ?? '',
        req.body as StudioProjectSaveInput,
      ),
    );
  }),
);

studioRouter.delete(
  '/projects/:id',
  asyncHandler(async (req: Request, res: Response) => {
    await studioService.deleteProject(userId(req), req.params['id'] ?? '');
    sendSuccess(res, { deleted: true });
  }),
);
