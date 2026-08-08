/**
 * Studio (DAW) project persistence (Stage 5). The project document is an
 * opaque JSON blob to the API (docs/DAW-PROJECT-FORMAT.md); ownership, names,
 * and bpm are first-class for the dashboard list. Mongo in production so
 * compositions survive anywhere the member signs in; in-memory for dev/test.
 * Soft delete only (Principle 4 — nothing a member makes is destroyed).
 */

import mongoose from 'mongoose';
import type { Model, Types } from 'mongoose';
import { randomUUID } from '@/shared/crypto';
import { useDatabase } from '@/shared/db/driver';

const { Schema } = mongoose;

export interface StudioProjectRecord {
  id: string;
  ownerId: string;
  name: string;
  bpm: number;
  data: unknown;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface StudioProjectWrite {
  name: string;
  bpm: number;
  data: unknown;
}

export interface StudioRepository {
  create(ownerId: string, input: StudioProjectWrite): Promise<StudioProjectRecord>;
  findById(id: string): Promise<StudioProjectRecord | null>;
  /** The owner's projects, most recently edited first. Data excluded. */
  listByOwner(ownerId: string): Promise<StudioProjectRecord[]>;
  update(id: string, input: StudioProjectWrite): Promise<StudioProjectRecord | null>;
  softDelete(id: string): Promise<boolean>;
}

// ── In-memory ────────────────────────────────────────────────────────────────

export class InMemoryStudioRepository implements StudioRepository {
  private readonly byId = new Map<string, StudioProjectRecord>();

  async create(ownerId: string, input: StudioProjectWrite): Promise<StudioProjectRecord> {
    const now = new Date();
    const record: StudioProjectRecord = {
      id: randomUUID(),
      ownerId,
      name: input.name,
      bpm: input.bpm,
      data: input.data,
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.byId.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<StudioProjectRecord | null> {
    const record = this.byId.get(id);
    return record && !record.deletedAt ? record : null;
  }

  async listByOwner(ownerId: string): Promise<StudioProjectRecord[]> {
    return [...this.byId.values()]
      .filter((p) => p.ownerId === ownerId && !p.deletedAt)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async update(id: string, input: StudioProjectWrite): Promise<StudioProjectRecord | null> {
    const record = this.byId.get(id);
    if (!record || record.deletedAt) return null;
    record.name = input.name;
    record.bpm = input.bpm;
    record.data = input.data;
    record.version += 1;
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

// ── Mongo ────────────────────────────────────────────────────────────────────

interface StudioProjectFields {
  _id: Types.ObjectId;
  ownerId: string;
  name: string;
  bpm: number;
  data: unknown;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const studioProjectSchema = new Schema<StudioProjectFields>(
  {
    ownerId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    bpm: { type: Number, required: true },
    data: { type: Schema.Types.Mixed, required: true },
    version: { type: Number, default: 1 },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'studio_projects', minimize: false },
);
studioProjectSchema.index({ ownerId: 1, updatedAt: -1 });

const StudioProjectModel: Model<StudioProjectFields> =
  (mongoose.models['StudioProject'] as Model<StudioProjectFields> | undefined) ??
  mongoose.model<StudioProjectFields>('StudioProject', studioProjectSchema);

function toRecord(doc: StudioProjectFields): StudioProjectRecord {
  return {
    id: doc._id.toString(),
    ownerId: doc.ownerId,
    name: doc.name,
    bpm: doc.bpm,
    data: doc.data,
    version: doc.version,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    deletedAt: doc.deletedAt,
  };
}

export class MongoStudioRepository implements StudioRepository {
  async create(ownerId: string, input: StudioProjectWrite): Promise<StudioProjectRecord> {
    const doc = await StudioProjectModel.create({
      ownerId,
      name: input.name,
      bpm: input.bpm,
      data: input.data,
      deletedAt: null,
    });
    return toRecord(doc.toObject());
  }

  async findById(id: string): Promise<StudioProjectRecord | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await StudioProjectModel.findOne({ _id: id, deletedAt: null }).lean();
    return doc ? toRecord(doc) : null;
  }

  async listByOwner(ownerId: string): Promise<StudioProjectRecord[]> {
    const docs = await StudioProjectModel.find({ ownerId, deletedAt: null })
      .select({ data: 0 })
      .sort({ updatedAt: -1 })
      .lean();
    return docs.map((d) => toRecord({ ...d, data: null } as StudioProjectFields));
  }

  async update(id: string, input: StudioProjectWrite): Promise<StudioProjectRecord | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await StudioProjectModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { name: input.name, bpm: input.bpm, data: input.data }, $inc: { version: 1 } },
      { new: true },
    ).lean();
    return doc ? toRecord(doc) : null;
  }

  async softDelete(id: string): Promise<boolean> {
    if (!mongoose.isValidObjectId(id)) return false;
    const result = await StudioProjectModel.updateOne(
      { _id: id, deletedAt: null },
      { $set: { deletedAt: new Date() } },
    );
    return result.modifiedCount > 0;
  }
}

export const studioRepository: StudioRepository = useDatabase()
  ? new MongoStudioRepository()
  : new InMemoryStudioRepository();
