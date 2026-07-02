/**
 * Recording controllers (ARCHITECTURE.md §8 upload flow, §12 RECORDINGS).
 *
 * The upload endpoints implement the presigned-URL flow: the API mints a
 * short-lived R2 upload URL with a UUID key (audio never passes through Node —
 * CLAUDE.md hard rule) and later verifies the object exists. List/get read from
 * the recordings repository (an in-memory stub in Phase 0, MongoDB in Phase 2).
 */

import type { Request, Response } from 'express';
import type { Paginated, PublicRecording } from '@sma/types';
import type { RecordingQueryInput, UploadUrlRequestInput } from '@sma/validators';
import { sendSuccess } from '@/shared/http/respond';
import { badRequest, notFound } from '@/shared/errors/AppError';
import { generateUploadUrl, generateDownloadUrl, objectExists } from '@/shared/storage/r2';
import { recordingRepository } from './recordings.repository';

export async function list(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as RecordingQueryInput;
  const page: Paginated<PublicRecording> = await recordingRepository.list(query);
  sendSuccess(res, page);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const id = req.params['id'] ?? '';
  const recording = await recordingRepository.findById(id);
  if (!recording) throw notFound('RECORDING_NOT_FOUND', 'Recording not found');
  sendSuccess(res, recording);
}

export async function getAudio(req: Request, res: Response): Promise<void> {
  const id = req.params['id'] ?? '';
  const fileKey = await recordingRepository.getFileKey(id);
  if (!fileKey) throw notFound('RECORDING_NOT_FOUND', 'Recording not found');
  const signed = await generateDownloadUrl(fileKey);
  sendSuccess(res, signed);
}

export async function createUploadUrl(req: Request, res: Response): Promise<void> {
  const body = req.body as UploadUrlRequestInput;
  const presigned = await generateUploadUrl(body.contentType);
  // A draft recording id is created alongside the key so the client can reference
  // it on upload-complete. Repository assigns the id in Phase 2; echo the key now.
  sendSuccess(res, presigned, 201);
}

export async function completeUpload(req: Request, res: Response): Promise<void> {
  const { fileKey } = req.body as { fileKey: string };
  const exists = await objectExists(fileKey);
  if (!exists) {
    throw badRequest('VALIDATION_ERROR', 'No uploaded object found for that fileKey');
  }
  // Phase 1: enqueue the audio:process + ai:* jobs (BullMQ) and flip status to
  // "processing" (ARCHITECTURE.md §8 step 5). For now, acknowledge receipt.
  sendSuccess(res, { fileKey, status: 'processing' as const });
}
