/**
 * MongoDB library persistence — binds when PERSISTENCE=database so the shelf
 * survives restarts/cold starts (files were already durable in R2; this makes
 * their metadata match). Same interface as the in-memory driver (ADR-0005).
 */

import mongoose from 'mongoose';
import type { BookContentType } from '@sma/types';
import { LibraryBookModel, type LibraryBookFields } from './book.model';
import type { BookRecord, CreateBookRecord, LibraryRepository } from './library.repository';

function toRecord(doc: LibraryBookFields): BookRecord {
  return {
    id: doc._id.toString(),
    title: doc.title,
    author: doc.author,
    description: doc.description,
    contentType: doc.contentType as BookContentType,
    fileKey: doc.fileKey,
    uploadedBy: doc.uploadedBy,
    createdAt: doc.createdAt,
    deletedAt: doc.deletedAt,
  };
}

export class MongoLibraryRepository implements LibraryRepository {
  async create(input: CreateBookRecord): Promise<BookRecord> {
    const doc = await LibraryBookModel.create({
      title: input.title,
      author: input.author,
      description: input.description,
      contentType: input.contentType,
      fileKey: input.fileKey,
      uploadedBy: input.uploadedBy,
      deletedAt: null,
    });
    return toRecord(doc.toObject());
  }

  async findById(id: string): Promise<BookRecord | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await LibraryBookModel.findOne({ _id: id, deletedAt: null }).lean();
    return doc ? toRecord(doc) : null;
  }

  async list(): Promise<BookRecord[]> {
    const docs = await LibraryBookModel.find({ deletedAt: null }).sort({ createdAt: -1 }).lean();
    return docs.map(toRecord);
  }

  async softDelete(id: string): Promise<boolean> {
    if (!mongoose.isValidObjectId(id)) return false;
    const result = await LibraryBookModel.updateOne(
      { _id: id, deletedAt: null },
      { $set: { deletedAt: new Date() } },
    );
    return result.modifiedCount > 0;
  }
}
