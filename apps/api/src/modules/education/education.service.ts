/**
 * Education service (SESSION "teaching") — educator-authored lessons.
 *
 * Mirrors the library upload flow (§8): presigned R2 PUT for attachments
 * (files never pass through Node — CONVENTIONS.md hard rule) → the lesson
 * record only accepts attachment keys verified to exist in R2.
 *
 * Visibility: published lessons are public reading material; drafts are
 * visible only to their author (and admins). Editing/deleting is author-or-
 * admin. Deletion is soft (Principle 4).
 */

import type { LessonAttachment, SignedAttachmentUrl, TeachingLesson, UserRole } from '@sma/types';
import type {
  LessonCreateInput,
  LessonUpdateInput,
  LessonUploadUrlRequestInput,
} from '@sma/validators';
import { badRequest, forbidden, notFound } from '@/shared/errors/AppError';
import { asIso } from '@/shared/brand';
import { generateUploadUrl, generateDownloadUrl, verifyExists } from '@/shared/storage/r2';
import { userRepository } from '@/modules/auth/user.repository';
import {
  educationRepository,
  type EducationRepository,
  type TeachingLessonRecord,
} from './education.repository';

/** The signed-in principal acting on a lesson (from `req.user`). */
export interface EducationActor {
  id: string;
  role: UserRole;
}

export interface LessonPresignResult {
  uploadUrl: string;
  fileKey: string;
  expiresAt: string;
}

export interface EducationServiceDeps {
  repo: EducationRepository;
  storage: {
    generateUploadUrl(
      contentType: string,
      prefix: 'lessons',
    ): Promise<{ uploadUrl: string; fileKey: string; expiresAt: string }>;
    generateDownloadUrl(fileKey: string): Promise<{ url: string; expiresAt: string }>;
    verifyExists(fileKey: string): Promise<boolean>;
  };
  /** Resolves the author's display name for the denormalised snapshot. */
  resolveAuthorName(userId: string): Promise<string>;
}

function toPublic(record: TeachingLessonRecord): TeachingLesson {
  return {
    id: record.id,
    title: record.title,
    summary: record.summary,
    body: record.body,
    track: record.track,
    attachments: record.attachments,
    authorId: record.authorId,
    authorName: record.authorName,
    status: record.status,
    createdAt: asIso(record.createdAt),
    updatedAt: asIso(record.updatedAt),
  };
}

function canManage(record: TeachingLessonRecord, actor: EducationActor): boolean {
  return record.authorId === actor.id || actor.role === 'admin';
}

/** Re-shape validated attachment inputs into the exact wire type — Zod infers
 * `sizeBytes?: number | undefined`, which exactOptionalPropertyTypes rejects. */
function toAttachments(
  list: readonly LessonCreateInput['attachments'][number][],
): LessonAttachment[] {
  return list.map((a) => ({
    fileKey: a.fileKey,
    name: a.name,
    contentType: a.contentType,
    ...(a.sizeBytes !== undefined ? { sizeBytes: a.sizeBytes } : {}),
  }));
}

export function createEducationService(deps: EducationServiceDeps) {
  const { repo, storage, resolveAuthorName } = deps;

  async function verifyAttachments(
    attachments: readonly { fileKey: string; name: string }[],
  ): Promise<void> {
    for (const attachment of attachments) {
      const exists = await storage.verifyExists(attachment.fileKey);
      if (!exists) {
        throw badRequest(
          'VALIDATION_ERROR',
          `Attachment "${attachment.name}" was not found in storage — upload it first.`,
        );
      }
    }
  }

  async function createUploadUrl(input: LessonUploadUrlRequestInput): Promise<LessonPresignResult> {
    return storage.generateUploadUrl(input.contentType, 'lessons');
  }

  async function createLesson(
    input: LessonCreateInput,
    actor: EducationActor,
  ): Promise<TeachingLesson> {
    await verifyAttachments(input.attachments);
    const authorName = await resolveAuthorName(actor.id);
    const record = await repo.create({
      title: input.title,
      summary: input.summary,
      body: input.body,
      track: input.track,
      attachments: toAttachments(input.attachments),
      authorId: actor.id,
      authorName,
      status: input.status,
    });
    return toPublic(record);
  }

  /** Published lessons — the public reading list. */
  async function listPublished(): Promise<TeachingLesson[]> {
    const records = await repo.listPublished();
    return records.map(toPublic);
  }

  /** The caller's own lessons, drafts included. */
  async function listMine(actor: EducationActor): Promise<TeachingLesson[]> {
    const records = await repo.listByAuthor(actor.id);
    return records.map(toPublic);
  }

  /** A single lesson. Drafts exist only for their author/admins — anyone else
   * gets NOT_FOUND (no existence leak). `viewer` is null for anonymous reads. */
  async function getLesson(id: string, viewer: EducationActor | null): Promise<TeachingLesson> {
    const record = await repo.findById(id);
    if (!record) throw notFound('LESSON_NOT_FOUND', 'Lesson not found');
    if (record.status !== 'published' && (!viewer || !canManage(record, viewer))) {
      throw notFound('LESSON_NOT_FOUND', 'Lesson not found');
    }
    return toPublic(record);
  }

  async function updateLesson(
    id: string,
    input: LessonUpdateInput,
    actor: EducationActor,
  ): Promise<TeachingLesson> {
    const record = await repo.findById(id);
    if (!record) throw notFound('LESSON_NOT_FOUND', 'Lesson not found');
    if (!canManage(record, actor)) throw forbidden('Only the author can edit this lesson');
    if (input.attachments !== undefined) await verifyAttachments(input.attachments);
    const updated = await repo.update(id, {
      title: input.title,
      summary: input.summary,
      body: input.body,
      track: input.track,
      attachments: input.attachments !== undefined ? toAttachments(input.attachments) : undefined,
      status: input.status,
    });
    if (!updated) throw notFound('LESSON_NOT_FOUND', 'Lesson not found');
    return toPublic(updated);
  }

  async function deleteLesson(id: string, actor: EducationActor): Promise<void> {
    const record = await repo.findById(id);
    if (!record) throw notFound('LESSON_NOT_FOUND', 'Lesson not found');
    if (!canManage(record, actor)) throw forbidden('Only the author can remove this lesson');
    await repo.softDelete(id);
  }

  /** Signed 1-hour read URL for one attachment of a visible lesson. The key must
   * belong to the lesson — this endpoint never signs arbitrary bucket keys. */
  async function getAttachmentUrl(
    id: string,
    fileKey: string,
    viewer: EducationActor | null,
  ): Promise<SignedAttachmentUrl> {
    const lesson = await getLesson(id, viewer);
    const attachment = lesson.attachments.find((a) => a.fileKey === fileKey);
    if (!attachment) throw notFound('NOT_FOUND', 'Attachment not found on this lesson');
    const signed = await storage.generateDownloadUrl(attachment.fileKey);
    return { url: signed.url, expiresAt: asIso(signed.expiresAt) };
  }

  return {
    createUploadUrl,
    createLesson,
    listPublished,
    listMine,
    getLesson,
    updateLesson,
    deleteLesson,
    getAttachmentUrl,
  };
}

export type EducationService = ReturnType<typeof createEducationService>;

export const educationService: EducationService = createEducationService({
  repo: educationRepository,
  storage: { generateUploadUrl, generateDownloadUrl, verifyExists },
  resolveAuthorName: async (userId) => {
    const user = await userRepository.findById(userId);
    return user?.displayName ?? 'Educator';
  },
});
