/**
 * Generation controllers — thin request/response shims over the service.
 */

import type { Request, Response } from 'express';
import type { GenerateRequestInput } from '@sma/validators';
import { sendSuccess } from '@/shared/http/respond';
import { unauthorized } from '@/shared/errors/AppError';
import { logger } from '@/shared/logger';
import { generationService } from './generation.service';

export async function createGeneration(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  const job = await generationService.createJob(req.user.id, req.body as GenerateRequestInput);
  sendSuccess(res, job, 201);
}

export async function getGeneration(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  const jobId = req.params['jobId'] as string;
  sendSuccess(res, await generationService.getJob(req.user.id, jobId));
}

/**
 * Suno reseller webhook — a deliberate no-op. The reseller requires a
 * callBackUrl; we accept, log at debug, and IGNORE the payload (it cannot be
 * authenticated, so job state only ever comes from authenticated poll-through
 * against the provider). Always 200 so the reseller marks delivery clean.
 */
export async function generationCallback(req: Request, res: Response): Promise<void> {
  logger.debug(
    { module: 'generation', bytes: JSON.stringify(req.body ?? null).length },
    'generation callback received (ignored by design)',
  );
  sendSuccess(res, { received: true });
}
