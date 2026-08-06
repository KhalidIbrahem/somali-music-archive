/**
 * Library service — presigned upload + shelf management for music-sheet books.
 *
 * Mirrors the recordings upload flow (§8): issue a presigned R2 PUT (documents
 * never pass through Node — CONVENTIONS.md hard rule) → client uploads → the shelf
 * record is only created after the object is verified to exist in R2.
 */

import type { LibraryBook, SignedBookUrl } from '@sma/types';
import type { BookCreateInput, BookUploadUrlRequestInput } from '@sma/validators';
import { badRequest, notFound } from '@/shared/errors/AppError';
import { asIso } from '@/shared/brand';
import { generateUploadUrl, generateDownloadUrl, verifyExists } from '@/shared/storage/r2';
import { libraryRepository, type BookRecord, type LibraryRepository } from './library.repository';

export interface BookPresignResult {
  uploadUrl: string;
  fileKey: string;
  expiresAt: string;
}

export interface LibraryServiceDeps {
  repo: LibraryRepository;
  storage: {
    generateUploadUrl(
      contentType: string,
      prefix: 'library',
    ): Promise<{ uploadUrl: string; fileKey: string; expiresAt: string }>;
    generateDownloadUrl(fileKey: string): Promise<{ url: string; expiresAt: string }>;
    verifyExists(fileKey: string): Promise<boolean>;
  };
}

function toPublic(record: BookRecord): LibraryBook {
  return {
    id: record.id,
    title: record.title,
    author: record.author,
    description: record.description,
    contentType: record.contentType,
    fileKey: record.fileKey,
    uploadedBy: record.uploadedBy,
    createdAt: asIso(record.createdAt),
  };
}

export function createLibraryService(deps: LibraryServiceDeps) {
  const { repo, storage } = deps;

  async function createUploadUrl(input: BookUploadUrlRequestInput): Promise<BookPresignResult> {
    return storage.generateUploadUrl(input.contentType, 'library');
  }

  async function createBook(input: BookCreateInput, uploadedBy: string): Promise<LibraryBook> {
    const exists = await storage.verifyExists(input.fileKey);
    if (!exists) {
      throw badRequest(
        'VALIDATION_ERROR',
        'The document was not found in storage — upload it first.',
      );
    }
    const record = await repo.create({
      title: input.title,
      author: input.author ?? null,
      description: input.description ?? null,
      contentType: input.contentType,
      fileKey: input.fileKey,
      uploadedBy,
    });
    return toPublic(record);
  }

  async function listBooks(): Promise<LibraryBook[]> {
    const records = await repo.list();
    return records.map(toPublic);
  }

  async function getFileUrl(id: string): Promise<SignedBookUrl> {
    const record = await repo.findById(id);
    if (!record) throw notFound('NOT_FOUND', 'Book not found');
    const signed = await storage.generateDownloadUrl(record.fileKey);
    return { url: signed.url, expiresAt: asIso(signed.expiresAt) };
  }

  return { createUploadUrl, createBook, listBooks, getFileUrl };
}

export const libraryService: ReturnType<typeof createLibraryService> = createLibraryService({
  repo: libraryRepository,
  storage: { generateUploadUrl, generateDownloadUrl, verifyExists },
});
