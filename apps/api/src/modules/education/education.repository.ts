/**
 * Education persistence — educator-authored lessons/teaching resources.
 *
 * Interface-first (ADR-0005): the in-memory implementation drives tests and
 * dev-without-a-database; the Mongo-backed implementation binds in production
 * (PERSISTENCE=database) so lessons survive serverless cold starts. Lessons are
 * archive material — removal is a SOFT delete (Principle 4).
 */

import type { LessonAttachment, TeachingLessonStatus, TeachingTrack } from '@sma/types';
import { randomUUID } from '@/shared/crypto';
import { useDatabase } from '@/shared/db/driver';
import { MongoEducationRepository } from './education.mongo.repository';

export interface TeachingLessonRecord {
  id: string;
  title: string;
  summary: string;
  body: string;
  track: TeachingTrack;
  attachments: LessonAttachment[];
  authorId: string;
  /** Denormalised display-name snapshot at authoring time. */
  authorName: string;
  status: TeachingLessonStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateTeachingLessonRecord {
  title: string;
  summary: string;
  body: string;
  track: TeachingTrack;
  attachments: LessonAttachment[];
  authorId: string;
  authorName: string;
  status: TeachingLessonStatus;
}

export interface UpdateTeachingLessonRecord {
  title?: string | undefined;
  summary?: string | undefined;
  body?: string | undefined;
  track?: TeachingTrack | undefined;
  attachments?: LessonAttachment[] | undefined;
  status?: TeachingLessonStatus | undefined;
}

export interface EducationRepository {
  create(input: CreateTeachingLessonRecord): Promise<TeachingLessonRecord>;
  /** Excludes soft-deleted lessons. */
  findById(id: string): Promise<TeachingLessonRecord | null>;
  /** Published lessons, newest first. */
  listPublished(): Promise<TeachingLessonRecord[]>;
  /** Every live lesson by one author (drafts included), newest first. */
  listByAuthor(authorId: string): Promise<TeachingLessonRecord[]>;
  update(id: string, patch: UpdateTeachingLessonRecord): Promise<TeachingLessonRecord | null>;
  softDelete(id: string): Promise<boolean>;
}

export class InMemoryEducationRepository implements EducationRepository {
  private readonly byId = new Map<string, TeachingLessonRecord>();

  async create(input: CreateTeachingLessonRecord): Promise<TeachingLessonRecord> {
    const now = new Date();
    const record: TeachingLessonRecord = {
      id: randomUUID(),
      title: input.title,
      summary: input.summary,
      body: input.body,
      track: input.track,
      attachments: [...input.attachments],
      authorId: input.authorId,
      authorName: input.authorName,
      status: input.status,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.byId.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<TeachingLessonRecord | null> {
    const record = this.byId.get(id);
    return record && !record.deletedAt ? record : null;
  }

  async listPublished(): Promise<TeachingLessonRecord[]> {
    return [...this.byId.values()]
      .filter((l) => !l.deletedAt && l.status === 'published')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async listByAuthor(authorId: string): Promise<TeachingLessonRecord[]> {
    return [...this.byId.values()]
      .filter((l) => !l.deletedAt && l.authorId === authorId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async update(
    id: string,
    patch: UpdateTeachingLessonRecord,
  ): Promise<TeachingLessonRecord | null> {
    const record = this.byId.get(id);
    if (!record || record.deletedAt) return null;
    if (patch.title !== undefined) record.title = patch.title;
    if (patch.summary !== undefined) record.summary = patch.summary;
    if (patch.body !== undefined) record.body = patch.body;
    if (patch.track !== undefined) record.track = patch.track;
    if (patch.attachments !== undefined) record.attachments = [...patch.attachments];
    if (patch.status !== undefined) record.status = patch.status;
    record.updatedAt = new Date();
    return record;
  }

  async softDelete(id: string): Promise<boolean> {
    const record = this.byId.get(id);
    if (!record || record.deletedAt) return false;
    record.deletedAt = new Date();
    return true;
  }
}

/**
 * Process-wide repository: Mongo when PERSISTENCE=database, else in-memory
 * (tests + local dev without a database). Both satisfy `EducationRepository`,
 * so the service depends only on the interface (ADR-0005).
 */
export const educationRepository: EducationRepository = useDatabase()
  ? new MongoEducationRepository()
  : new InMemoryEducationRepository();
