import { describe, it, expect } from 'vitest';
import {
  lessonCreateSchema,
  lessonUpdateSchema,
  lessonUploadUrlRequestSchema,
  MAX_LESSON_ATTACHMENTS,
} from './education';

const attachment = {
  fileKey: 'lessons/ab/1f2e3d4c-0000-4000-8000-000000000000.pdf',
  name: 'Week 1 — Qaraami origins.pdf',
  contentType: 'application/pdf' as const,
  sizeBytes: 1024,
};

describe('lessonCreateSchema', () => {
  it('accepts a text-only lesson and applies defaults', () => {
    const parsed = lessonCreateSchema.parse({ title: 'The pentatonic core', body: 'Somali…' });
    expect(parsed.track).toBe('general');
    expect(parsed.status).toBe('published');
    expect(parsed.attachments).toEqual([]);
  });

  it('accepts an attachment-only lesson', () => {
    const parsed = lessonCreateSchema.parse({
      title: 'Course reader',
      attachments: [attachment],
    });
    expect(parsed.attachments).toHaveLength(1);
  });

  it('rejects a lesson with no text and no attachments', () => {
    const result = lessonCreateSchema.safeParse({ title: 'Empty lesson' });
    expect(result.success).toBe(false);
  });

  it('rejects attachment keys outside the lessons/ namespace', () => {
    const result = lessonCreateSchema.safeParse({
      title: 'Sneaky',
      attachments: [{ ...attachment, fileKey: 'recordings/ab/other.pdf' }],
    });
    expect(result.success).toBe(false);
  });

  it('caps the number of attachments', () => {
    const result = lessonCreateSchema.safeParse({
      title: 'Bulk drop',
      attachments: Array.from({ length: MAX_LESSON_ATTACHMENTS + 1 }, () => attachment),
    });
    expect(result.success).toBe(false);
  });
});

describe('lessonUpdateSchema', () => {
  it('requires at least one field', () => {
    expect(lessonUpdateSchema.safeParse({}).success).toBe(false);
    expect(lessonUpdateSchema.safeParse({ status: 'draft' }).success).toBe(true);
  });
});

describe('lessonUploadUrlRequestSchema', () => {
  it('accepts the allowed content types', () => {
    for (const contentType of ['application/pdf', 'audio/mpeg', 'image/png'] as const) {
      expect(
        lessonUploadUrlRequestSchema.safeParse({ filename: 'a.bin', contentType }).success,
      ).toBe(true);
    }
  });

  it('rejects disallowed content types', () => {
    const result = lessonUploadUrlRequestSchema.safeParse({
      filename: 'movie.mp4',
      contentType: 'video/mp4',
    });
    expect(result.success).toBe(false);
  });
});
