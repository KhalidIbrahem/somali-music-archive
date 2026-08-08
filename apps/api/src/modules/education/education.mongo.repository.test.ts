/**
 * Mongo repository integration tests for the teaching/library durability layer
 * (SESSION "teaching"). Runs against a REAL MongoDB via mongodb-memory-server
 * (in-process mongod — no network, no Atlas), asserting the same repository
 * contracts the in-memory implementations honour (ADR-0005). First run
 * downloads the mongod binary, hence the generous beforeAll timeout.
 */

import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, disconnectMongo } from '@/shared/db/mongoose';
import { MongoLibraryRepository } from '@/modules/library/library.mongo.repository';
import { LibraryBookModel } from '@/modules/library/book.model';
import { TeachingLessonModel } from './teachingLesson.model';
import { MongoEducationRepository } from './education.mongo.repository';
import type { CreateTeachingLessonRecord } from './education.repository';

let server: MongoMemoryServer;
const lessons = new MongoEducationRepository();
const books = new MongoLibraryRepository();

const lessonInput: CreateTeachingLessonRecord = {
  title: 'Qaraami and the pentatonic scale',
  summary: 'Week 1 lecture notes.',
  body: 'The qaraami repertoire is built on…',
  track: 'beginner',
  attachments: [
    {
      fileKey: 'lessons/ab/reader.pdf',
      name: 'reader.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
    },
  ],
  authorId: 'educator-1',
  authorName: 'Prof. Rehanna Kashogi',
  status: 'published',
};

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await connectMongo(server.getUri());
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await server.stop();
});

beforeEach(async () => {
  await TeachingLessonModel.deleteMany({});
  await LibraryBookModel.deleteMany({});
});

describe('MongoEducationRepository', () => {
  it('round-trips a lesson with attachments', async () => {
    const created = await lessons.create(lessonInput);
    expect(created.id).toMatch(/^[a-f0-9]{24}$/i);
    const read = await lessons.findById(created.id);
    expect(read).toMatchObject({
      title: lessonInput.title,
      track: 'beginner',
      authorName: 'Prof. Rehanna Kashogi',
      status: 'published',
    });
    expect(read?.attachments).toEqual(lessonInput.attachments);
  });

  it('listPublished excludes drafts; listByAuthor includes them', async () => {
    await lessons.create(lessonInput);
    await lessons.create({ ...lessonInput, title: 'Draft notes', status: 'draft' });
    const published = await lessons.listPublished();
    expect(published.map((l) => l.title)).toEqual([lessonInput.title]);
    const mine = await lessons.listByAuthor('educator-1');
    expect(mine).toHaveLength(2);
  });

  it('updates fields and publishes a draft', async () => {
    const draft = await lessons.create({ ...lessonInput, status: 'draft' });
    const updated = await lessons.update(draft.id, { status: 'published', title: 'Final title' });
    expect(updated).toMatchObject({ status: 'published', title: 'Final title' });
    // Unchanged fields survive the $set.
    expect(updated?.body).toBe(lessonInput.body);
  });

  it('soft-deletes (document remains, reads exclude it)', async () => {
    const created = await lessons.create(lessonInput);
    expect(await lessons.softDelete(created.id)).toBe(true);
    expect(await lessons.findById(created.id)).toBeNull();
    expect(await lessons.listPublished()).toHaveLength(0);
    // NEVER hard-deleted (CONVENTIONS.md): the raw document is still in Mongo.
    const raw = await TeachingLessonModel.findById(created.id).lean();
    expect(raw?.deletedAt).toBeInstanceOf(Date);
  });

  it('returns null/false for malformed ids instead of throwing', async () => {
    expect(await lessons.findById('not-an-objectid')).toBeNull();
    expect(await lessons.update('not-an-objectid', { title: 'X title' })).toBeNull();
    expect(await lessons.softDelete('not-an-objectid')).toBe(false);
  });
});

describe('MongoLibraryRepository', () => {
  it('round-trips a book and lists newest-first', async () => {
    const first = await books.create({
      title: 'Somali songbook, vol. 1',
      author: 'Unknown',
      description: null,
      contentType: 'application/pdf',
      fileKey: 'library/ab/one.pdf',
      uploadedBy: 'user-1',
    });
    const second = await books.create({
      title: 'Somali songbook, vol. 2',
      author: null,
      description: 'Second volume',
      contentType: 'application/pdf',
      fileKey: 'library/ab/two.pdf',
      uploadedBy: 'user-1',
    });
    const shelf = await books.list();
    expect(shelf.map((b) => b.id)).toEqual([second.id, first.id]);
    expect(await books.findById(first.id)).toMatchObject({ title: 'Somali songbook, vol. 1' });
  });

  it('soft-deletes without destroying the document', async () => {
    const book = await books.create({
      title: 'Fragile scan',
      author: null,
      description: null,
      contentType: 'image/png',
      fileKey: 'library/cd/scan.png',
      uploadedBy: 'user-2',
    });
    expect(await books.softDelete(book.id)).toBe(true);
    expect(await books.findById(book.id)).toBeNull();
    const raw = await LibraryBookModel.findById(book.id).lean();
    expect(raw?.deletedAt).toBeInstanceOf(Date);
  });
});
