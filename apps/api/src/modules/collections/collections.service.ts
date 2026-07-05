/**
 * Collections service (SESSION P4-05, ARCHITECTURE.md §16 Phase 4).
 *
 * User-curated lists of recordings. Owners manage their own collections; a public
 * collection is readable by any signed-in user. Items are stored by the recording's
 * canonical ObjectId and only PUBLISHED recordings may be added; the detailed view
 * hydrates items to recordings and silently drops any that have since left the
 * archive — so a collection can never leak unpublished material.
 *
 * Injected repositories (ADR-0005) so every branch is unit-testable in-memory.
 */

import type { CollectionWithItems, Paginated, PublicCollection, PublicRecording } from '@sma/types';
import type { AddCollectionItemInput, CreateCollectionInput } from '@sma/validators';
import { asIso, asUuid } from '@/shared/brand';
import { forbidden, notFound } from '@/shared/errors/AppError';
import {
  recordingRepository,
  type RecordingRepository,
} from '@/modules/recordings/recordings.repository';
import {
  collectionRepository,
  type CollectionRecord,
  type CollectionRepository,
} from './collections.repository';

function toPublicCollection(record: CollectionRecord, itemCount: number): PublicCollection {
  return {
    id: asUuid(record.id),
    name: record.name,
    isPublic: record.isPublic,
    itemCount,
    owner: { id: asUuid(record.ownerId) },
    createdAt: asIso(record.createdAt),
    ...(record.description ? { description: record.description } : {}),
  };
}

export interface CollectionsServiceDeps {
  repo: CollectionRepository;
  recordings: RecordingRepository;
}

export function createCollectionsService(deps: CollectionsServiceDeps) {
  const { repo, recordings } = deps;

  /** Load a collection the caller owns, or throw 404/403. */
  async function ownedOrThrow(ownerId: string, id: string): Promise<CollectionRecord> {
    const collection = await repo.findById(id);
    if (!collection) throw notFound('NOT_FOUND', 'Collection not found');
    if (collection.ownerId !== ownerId) throw forbidden();
    return collection;
  }

  async function createCollection(
    ownerId: string,
    input: CreateCollectionInput,
  ): Promise<PublicCollection> {
    const collection = await repo.create({
      ownerId,
      name: input.name,
      description: input.description ?? null,
      isPublic: input.isPublic,
    });
    return toPublicCollection(collection, 0);
  }

  async function listMine(ownerId: string): Promise<Paginated<PublicCollection>> {
    const collections = await repo.listForOwner(ownerId);
    const data = await Promise.all(
      collections.map(async (c) => toPublicCollection(c, await repo.countItems(c.id))),
    );
    return { data, total: data.length, page: 1, limit: data.length, hasMore: false };
  }

  async function getCollection(id: string, requesterId: string): Promise<CollectionWithItems> {
    const collection = await repo.findById(id);
    if (!collection) throw notFound('NOT_FOUND', 'Collection not found');
    if (!collection.isPublic && collection.ownerId !== requesterId) throw forbidden();

    const recordingIds = await repo.listItems(id);
    const items: PublicRecording[] = [];
    for (const recordingId of recordingIds) {
      const recording = await recordings.findById(recordingId);
      if (recording && recording.status === 'published') items.push(recording);
    }
    return { ...toPublicCollection(collection, recordingIds.length), items };
  }

  async function addItem(
    ownerId: string,
    id: string,
    input: AddCollectionItemInput,
  ): Promise<PublicCollection> {
    const collection = await ownedOrThrow(ownerId, id);
    const recording = await recordings.findById(input.recordingId);
    if (!recording || recording.status !== 'published') {
      throw notFound('RECORDING_NOT_FOUND', 'Recording not found');
    }
    await repo.addItem(id, String(recording._id));
    return toPublicCollection(collection, await repo.countItems(id));
  }

  async function removeItem(ownerId: string, id: string, recordingId: string): Promise<void> {
    await ownedOrThrow(ownerId, id);
    // Normalise to the canonical id when the recording still exists; otherwise try
    // the raw value so orphaned items can still be removed.
    const recording = await recordings.findById(recordingId);
    await repo.removeItem(id, recording ? String(recording._id) : recordingId);
  }

  async function deleteCollection(ownerId: string, id: string): Promise<void> {
    await ownedOrThrow(ownerId, id);
    await repo.deleteCollection(id);
  }

  return { createCollection, listMine, getCollection, addItem, removeItem, deleteCollection };
}

export type CollectionsService = ReturnType<typeof createCollectionsService>;

export const collectionsService: CollectionsService = createCollectionsService({
  repo: collectionRepository,
  recordings: recordingRepository,
});
