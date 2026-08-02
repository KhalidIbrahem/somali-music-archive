/**
 * Unit tests for the library service — presign flow, verified-object gate,
 * shelf listing order, and signed read URLs. Storage is mocked (no R2).
 */

import { describe, expect, it, vi } from 'vitest';
import { createLibraryService, type LibraryServiceDeps } from './library.service';
import { InMemoryLibraryRepository } from './library.repository';

function makeStorage(overrides?: Partial<LibraryServiceDeps['storage']>): {
  storage: LibraryServiceDeps['storage'];
  calls: { presigned: string[] };
} {
  const calls = { presigned: [] as string[] };
  const storage: LibraryServiceDeps['storage'] = {
    async generateUploadUrl(contentType, prefix) {
      calls.presigned.push(`${prefix}:${contentType}`);
      return {
        uploadUrl: 'https://r2.example/put',
        fileKey: 'library/ab/abc123.pdf',
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      };
    },
    async generateDownloadUrl(fileKey) {
      return {
        url: `https://r2.example/get/${fileKey}`,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      };
    },
    verifyExists: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  return { storage, calls };
}

function makeService(overrides?: Partial<LibraryServiceDeps['storage']>) {
  const repo = new InMemoryLibraryRepository();
  const { storage, calls } = makeStorage(overrides);
  return { service: createLibraryService({ repo, storage }), repo, calls };
}

const PDF_INPUT = {
  fileKey: 'library/ab/abc123.pdf',
  contentType: 'application/pdf' as const,
  title: 'Somali Music Sheets, Volume I',
  author: 'Unknown compiler',
};

describe('createUploadUrl', () => {
  it('presigns into the library namespace with the requested content type', async () => {
    const { service, calls } = makeService();
    const result = await service.createUploadUrl({
      filename: 'sheets.pdf',
      contentType: 'application/pdf',
    });
    expect(result.uploadUrl).toContain('https://');
    expect(result.fileKey).toMatch(/^library\//);
    expect(calls.presigned).toEqual(['library:application/pdf']);
  });
});

describe('createBook', () => {
  it('registers the book once the object is verified in storage', async () => {
    const { service } = makeService();
    const book = await service.createBook(PDF_INPUT, 'user-1');
    expect(book.title).toBe('Somali Music Sheets, Volume I');
    expect(book.uploadedBy).toBe('user-1');
    expect(book.contentType).toBe('application/pdf');
    expect(await service.listBooks()).toHaveLength(1);
  });

  it('rejects when the object never landed in R2', async () => {
    const { service } = makeService({ verifyExists: vi.fn().mockResolvedValue(false) });
    await expect(service.createBook(PDF_INPUT, 'user-1')).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(await service.listBooks()).toHaveLength(0);
  });
});

describe('listBooks', () => {
  it('returns newest first', async () => {
    const { service } = makeService();
    await service.createBook({ ...PDF_INPUT, title: 'First' }, 'user-1');
    await new Promise((r) => setTimeout(r, 5));
    await service.createBook({ ...PDF_INPUT, title: 'Second' }, 'user-1');
    const titles = (await service.listBooks()).map((b) => b.title);
    expect(titles).toEqual(['Second', 'First']);
  });
});

describe('getFileUrl', () => {
  it('signs a read URL for an existing book', async () => {
    const { service } = makeService();
    const book = await service.createBook(PDF_INPUT, 'user-1');
    const signed = await service.getFileUrl(book.id);
    expect(signed.url).toContain(book.fileKey);
  });

  it('404s for a missing book', async () => {
    const { service } = makeService();
    await expect(service.getFileUrl('nope')).rejects.toMatchObject({ statusCode: 404 });
  });
});
