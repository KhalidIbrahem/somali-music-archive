/**
 * Collection controllers (SESSION P4-05, ARCHITECTURE.md §16 Phase 4).
 */

import type { Request, Response } from 'express';
import type { AddCollectionItemInput, CreateCollectionInput } from '@sma/validators';
import { sendSuccess } from '@/shared/http/respond';
import { unauthorized } from '@/shared/errors/AppError';
import { collectionsService } from './collections.service';

export async function create(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  const collection = await collectionsService.createCollection(
    req.user.id,
    req.body as CreateCollectionInput,
  );
  sendSuccess(res, collection, 201);
}

export async function mine(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  sendSuccess(res, await collectionsService.listMine(req.user.id));
}

export async function getById(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  sendSuccess(res, await collectionsService.getCollection(req.params['id'] ?? '', req.user.id));
}

export async function addItem(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  const collection = await collectionsService.addItem(
    req.user.id,
    req.params['id'] ?? '',
    req.body as AddCollectionItemInput,
  );
  sendSuccess(res, collection);
}

export async function removeItem(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  await collectionsService.removeItem(
    req.user.id,
    req.params['id'] ?? '',
    req.params['recordingId'] ?? '',
  );
  sendSuccess(res, { removed: true });
}

export async function remove(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  await collectionsService.deleteCollection(req.user.id, req.params['id'] ?? '');
  sendSuccess(res, { deleted: true });
}
