/**
 * Internal controllers (SESSION P3-03). Thin adapter over the internal service;
 * the body is already validated (aiResultSchema) and the caller authenticated
 * (requireInternalKey) upstream.
 */

import type { Request, Response } from 'express';
import type { AiResultInput } from '@sma/validators';
import { sendSuccess } from '@/shared/http/respond';
import { internalService } from './internal.service';

export async function receiveAiResult(req: Request, res: Response): Promise<void> {
  await internalService.applyAiResult(req.params['id'] ?? '', req.body as AiResultInput);
  sendSuccess(res, { received: true });
}
