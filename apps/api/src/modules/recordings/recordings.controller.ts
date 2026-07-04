/**
 * Recording controllers (ARCHITECTURE.md §8 upload flow, §12 RECORDINGS).
 *
 * Thin adapters over `recordingsService`. The upload endpoints implement the
 * presigned-URL flow (audio never passes through Node — CLAUDE.md hard rule):
 * upload-url issues a URL + draft, upload-complete verifies + enqueues processing.
 */

import type { Request, Response } from 'express';
import type {
  ModerationQueryInput,
  RecordingModerationInput,
  RecordingQueryInput,
  UploadCompleteInput,
  UploadUrlRequestInput,
} from '@sma/validators';
import { sendSuccess } from '@/shared/http/respond';
import { recordingsService } from './recordings.service';

export async function moderationList(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ModerationQueryInput;
  sendSuccess(res, await recordingsService.listForModeration(query));
}

export async function updateRecording(req: Request, res: Response): Promise<void> {
  const updated = await recordingsService.moderateRecording(
    req.params['id'] ?? '',
    req.body as RecordingModerationInput,
  );
  sendSuccess(res, updated);
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as RecordingQueryInput;
  const page = await recordingsService.listRecordings(query);
  sendSuccess(res, page);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const recording = await recordingsService.getRecording(req.params['id'] ?? '');
  sendSuccess(res, recording);
}

export async function getSimilar(req: Request, res: Response): Promise<void> {
  const similar = await recordingsService.findSimilarRecordings(req.params['id'] ?? '');
  sendSuccess(res, similar);
}

export async function getAudio(req: Request, res: Response): Promise<void> {
  const signed = await recordingsService.getPlaybackUrl(req.params['id'] ?? '');
  sendSuccess(res, signed);
}

export async function createUploadUrl(req: Request, res: Response): Promise<void> {
  const result = await recordingsService.createUploadUrl(req.body as UploadUrlRequestInput);
  sendSuccess(res, result, 201);
}

export async function completeUpload(req: Request, res: Response): Promise<void> {
  const result = await recordingsService.completeUpload(req.body as UploadCompleteInput);
  sendSuccess(res, result);
}
