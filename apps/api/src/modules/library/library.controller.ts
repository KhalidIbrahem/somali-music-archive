/**
 * Library controllers — thin adapters over `libraryService` (§8 upload flow).
 */

import type { Request, Response } from 'express';
import type { BookCreateInput, BookUploadUrlRequestInput } from '@sma/validators';
import { sendSuccess } from '@/shared/http/respond';
import { libraryService } from './library.service';

export async function createUploadUrl(req: Request, res: Response): Promise<void> {
  const result = await libraryService.createUploadUrl(req.body as BookUploadUrlRequestInput);
  sendSuccess(res, result, 201);
}

export async function createBook(req: Request, res: Response): Promise<void> {
  const book = await libraryService.createBook(
    req.body as BookCreateInput,
    req.user?.id ?? 'unknown',
  );
  sendSuccess(res, book, 201);
}

export async function listBooks(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await libraryService.listBooks());
}

export async function getBookFile(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await libraryService.getFileUrl(req.params['id'] ?? ''));
}
