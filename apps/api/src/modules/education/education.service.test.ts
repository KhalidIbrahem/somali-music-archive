import { describe, it, expect, beforeEach } from 'vitest';
import { lessonCreateSchema } from '@sma/validators';
import { createEducationService, type EducationService } from './education.service';
import { InMemoryEducationRepository } from './education.repository';

const educator = { id: 'educator-1', role: 'educator' as const };
const otherEducator = { id: 'educator-2', role: 'educator' as const };
const admin = { id: 'admin-1', role: 'admin' as const };
const listener = { id: 'listener-1', role: 'listener' as const };

interface Harness {
  service: EducationService;
  /** Object keys the fake storage believes exist. */
  stored: Set<string>;
}

function makeHarness(): Harness {
  const stored = new Set<string>(['lessons/ab/existing.pdf']);
  const service = createEducationService({
    repo: new InMemoryEducationRepository(),
    storage: {
      generateUploadUrl: async (contentType, prefix) => ({
        uploadUrl: `https://r2.example/${prefix}/put`,
        fileKey: `${prefix}/ab/new-object.${contentType === 'application/pdf' ? 'pdf' : 'bin'}`,
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      }),
      generateDownloadUrl: async (fileKey) => ({
        url: `https://r2.example/get/${fileKey}`,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
      verifyExists: async (fileKey) => stored.has(fileKey),
    },
    resolveAuthorName: async (userId) =>
      userId === educator.id ? 'Prof. Rehanna Kashogi' : 'Someone Else',
  });
  return { service, stored };
}

/** Build a valid create input through the real schema (defaults applied). */
function lessonInput(overrides: Record<string, unknown> = {}) {
  return lessonCreateSchema.parse({
    title: 'Qaraami and the pentatonic scale',
    summary: 'Week 1 lecture notes.',
    body: 'The qaraami repertoire is built on…',
    ...overrides,
  });
}

let h: Harness;
beforeEach(() => {
  h = makeHarness();
});

describe('createLesson', () => {
  it('creates a published lesson with the author name snapshot', async () => {
    const lesson = await h.service.createLesson(lessonInput(), educator);
    expect(lesson.status).toBe('published');
    expect(lesson.authorName).toBe('Prof. Rehanna Kashogi');
    expect(lesson.track).toBe('general');
  });

  it('rejects attachments that were never uploaded to storage', async () => {
    const input = lessonInput({
      attachments: [
        { fileKey: 'lessons/zz/missing.pdf', name: 'ghost.pdf', contentType: 'application/pdf' },
      ],
    });
    await expect(h.service.createLesson(input, educator)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('accepts attachments that exist in storage', async () => {
    const input = lessonInput({
      attachments: [
        { fileKey: 'lessons/ab/existing.pdf', name: 'reader.pdf', contentType: 'application/pdf' },
      ],
    });
    const lesson = await h.service.createLesson(input, educator);
    expect(lesson.attachments).toHaveLength(1);
  });
});

describe('visibility', () => {
  it('lists only published lessons publicly; drafts stay with their author', async () => {
    await h.service.createLesson(lessonInput({ title: 'Published one' }), educator);
    const draft = await h.service.createLesson(
      lessonInput({ title: 'Draft one', status: 'draft' }),
      educator,
    );

    const publicList = await h.service.listPublished();
    expect(publicList.map((l) => l.title)).toEqual(['Published one']);

    const mine = await h.service.listMine(educator);
    expect(mine).toHaveLength(2);

    // Anonymous and unrelated viewers get NOT_FOUND for the draft.
    await expect(h.service.getLesson(draft.id, null)).rejects.toMatchObject({
      code: 'LESSON_NOT_FOUND',
    });
    await expect(h.service.getLesson(draft.id, listener)).rejects.toMatchObject({
      code: 'LESSON_NOT_FOUND',
    });
    // The author and admins can see it.
    await expect(h.service.getLesson(draft.id, educator)).resolves.toMatchObject({
      title: 'Draft one',
    });
    await expect(h.service.getLesson(draft.id, admin)).resolves.toMatchObject({
      title: 'Draft one',
    });
  });
});

describe('updateLesson / deleteLesson permissions', () => {
  it('lets the author edit and publish a draft', async () => {
    const draft = await h.service.createLesson(lessonInput({ status: 'draft' }), educator);
    const updated = await h.service.updateLesson(draft.id, { status: 'published' }, educator);
    expect(updated.status).toBe('published');
  });

  it('refuses another educator but allows an admin', async () => {
    const lesson = await h.service.createLesson(lessonInput(), educator);
    await expect(
      h.service.updateLesson(lesson.id, { title: 'Hijacked title' }, otherEducator),
    ).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
    await expect(
      h.service.updateLesson(lesson.id, { title: 'Corrected title' }, admin),
    ).resolves.toMatchObject({ title: 'Corrected title' });
  });

  it('soft-deletes: the lesson disappears from every list and read', async () => {
    const lesson = await h.service.createLesson(lessonInput(), educator);
    await h.service.deleteLesson(lesson.id, educator);
    expect(await h.service.listPublished()).toHaveLength(0);
    await expect(h.service.getLesson(lesson.id, educator)).rejects.toMatchObject({
      code: 'LESSON_NOT_FOUND',
    });
  });

  it('refuses deletion by a non-author educator', async () => {
    const lesson = await h.service.createLesson(lessonInput(), educator);
    await expect(h.service.deleteLesson(lesson.id, otherEducator)).rejects.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });
});

describe('attachments', () => {
  it('signs read URLs only for keys that belong to the lesson', async () => {
    const input = lessonInput({
      attachments: [
        { fileKey: 'lessons/ab/existing.pdf', name: 'reader.pdf', contentType: 'application/pdf' },
      ],
    });
    const lesson = await h.service.createLesson(input, educator);

    const signed = await h.service.getAttachmentUrl(lesson.id, 'lessons/ab/existing.pdf', null);
    expect(signed.url).toContain('lessons/ab/existing.pdf');

    await expect(
      h.service.getAttachmentUrl(lesson.id, 'recordings/xx/other.mp3', null),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('issues lesson-prefixed upload URLs', async () => {
    const presign = await h.service.createUploadUrl({
      filename: 'reader.pdf',
      contentType: 'application/pdf',
    });
    expect(presign.fileKey.startsWith('lessons/')).toBe(true);
  });
});
