/**
 * MongoDB education persistence (SESSION "teaching").
 *
 * The Mongo-backed `EducationRepository` — binds when PERSISTENCE=database so
 * authored lessons survive process restarts and serverless cold starts. Same
 * interface as the in-memory driver (ADR-0005), so no service changes.
 */

import mongoose from 'mongoose';
import type {
  LessonAttachment,
  LessonAttachmentContentType,
  TeachingLessonStatus,
  TeachingTrack,
} from '@sma/types';
import { TeachingLessonModel, type TeachingLessonFields } from './teachingLesson.model';
import type {
  CreateTeachingLessonRecord,
  EducationRepository,
  TeachingLessonRecord,
  UpdateTeachingLessonRecord,
} from './education.repository';

function toRecord(doc: TeachingLessonFields): TeachingLessonRecord {
  return {
    id: doc._id.toString(),
    title: doc.title,
    summary: doc.summary,
    body: doc.body,
    track: doc.track as TeachingTrack,
    attachments: doc.attachments.map((a): LessonAttachment => ({
      fileKey: a.fileKey,
      name: a.name,
      contentType: a.contentType as LessonAttachmentContentType,
      ...(a.sizeBytes !== undefined && a.sizeBytes !== null ? { sizeBytes: a.sizeBytes } : {}),
    })),
    authorId: doc.authorId,
    authorName: doc.authorName,
    status: doc.status as TeachingLessonStatus,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    deletedAt: doc.deletedAt,
  };
}

export class MongoEducationRepository implements EducationRepository {
  async create(input: CreateTeachingLessonRecord): Promise<TeachingLessonRecord> {
    const doc = await TeachingLessonModel.create({
      title: input.title,
      summary: input.summary,
      body: input.body,
      track: input.track,
      attachments: input.attachments.map((a) => ({ ...a })),
      authorId: input.authorId,
      authorName: input.authorName,
      status: input.status,
      deletedAt: null,
    });
    return toRecord(doc.toObject());
  }

  async findById(id: string): Promise<TeachingLessonRecord | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await TeachingLessonModel.findOne({ _id: id, deletedAt: null }).lean();
    return doc ? toRecord(doc) : null;
  }

  async listPublished(): Promise<TeachingLessonRecord[]> {
    const docs = await TeachingLessonModel.find({ status: 'published', deletedAt: null })
      .sort({ createdAt: -1 })
      .lean();
    return docs.map(toRecord);
  }

  async listByAuthor(authorId: string): Promise<TeachingLessonRecord[]> {
    const docs = await TeachingLessonModel.find({ authorId, deletedAt: null })
      .sort({ createdAt: -1 })
      .lean();
    return docs.map(toRecord);
  }

  async update(
    id: string,
    patch: UpdateTeachingLessonRecord,
  ): Promise<TeachingLessonRecord | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await TeachingLessonModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      {
        $set: {
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
          ...(patch.body !== undefined ? { body: patch.body } : {}),
          ...(patch.track !== undefined ? { track: patch.track } : {}),
          ...(patch.attachments !== undefined
            ? { attachments: patch.attachments.map((a) => ({ ...a })) }
            : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
        },
      },
      { new: true },
    ).lean();
    return doc ? toRecord(doc) : null;
  }

  async softDelete(id: string): Promise<boolean> {
    if (!mongoose.isValidObjectId(id)) return false;
    const result = await TeachingLessonModel.updateOne(
      { _id: id, deletedAt: null },
      { $set: { deletedAt: new Date() } },
    );
    return result.modifiedCount > 0;
  }
}
