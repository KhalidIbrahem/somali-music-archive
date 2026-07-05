/**
 * Research controllers (ARCHITECTURE.md §12 RESEARCH, SESSION P3-07).
 *
 * Key management is user-scoped (JWT-authenticated); the dataset export is
 * API-key-authenticated (see the routes). The plaintext key is returned only from
 * createKey, and only once.
 */

import type { Request, Response } from 'express';
import type { CreateApiKeyInput, ResearchDatasetQueryInput } from '@sma/validators';
import { sendSuccess } from '@/shared/http/respond';
import { notFound, unauthorized } from '@/shared/errors/AppError';
import { researchService } from './research.service';

export async function createKey(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  const created = await researchService.createApiKey(req.user.id, req.body as CreateApiKeyInput);
  sendSuccess(res, created, 201);
}

export async function listKeys(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  sendSuccess(res, await researchService.listKeys(req.user.id));
}

export async function revokeKey(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  const revoked = await researchService.revokeKey(req.user.id, req.params['id'] ?? '');
  if (!revoked) throw notFound('NOT_FOUND', 'API key not found');
  sendSuccess(res, { revoked: true });
}

export async function getDataset(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ResearchDatasetQueryInput;
  sendSuccess(res, await researchService.exportDataset(query));
}
