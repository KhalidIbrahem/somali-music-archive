/**
 * Collection routes (SESSION P4-05, ARCHITECTURE.md §16 Phase 4). All require a
 * signed-in user; ownership (and public-read) is enforced in the service. Literal
 * paths are registered before `/:id`.
 */

import { Router } from 'express';
import { addCollectionItemSchema, createCollectionSchema } from '@sma/validators';
import { validate } from '@/shared/middleware/validate';
import { authenticate } from '@/shared/middleware/authenticate';
import { asyncHandler } from '@/shared/http/asyncHandler';
import * as controller from './collections.controller';

export const collectionsRouter: Router = Router();

collectionsRouter.use(authenticate);

collectionsRouter.get('/mine', asyncHandler(controller.mine));
collectionsRouter.post(
  '/',
  validate({ body: createCollectionSchema }),
  asyncHandler(controller.create),
);

collectionsRouter.get('/:id', asyncHandler(controller.getById));
collectionsRouter.delete('/:id', asyncHandler(controller.remove));
collectionsRouter.post(
  '/:id/items',
  validate({ body: addCollectionItemSchema }),
  asyncHandler(controller.addItem),
);
collectionsRouter.delete('/:id/items/:recordingId', asyncHandler(controller.removeItem));
