/**
 * Recording persistence (ARCHITECTURE.md §9 MongoDB Recording document).
 *
 * Interface-first, same as the user repository: Phase 2 provides a Mongoose-backed
 * implementation with the indexes from §14. Phase 0 ships an empty in-memory stub
 * so the endpoints are wired and the shapes are exercised end-to-end.
 */

import type { Paginated, PublicRecording } from '@sma/types';
import type { RecordingQueryInput } from '@sma/validators';

export interface RecordingRepository {
  list(query: RecordingQueryInput): Promise<Paginated<PublicRecording>>;
  findById(id: string): Promise<PublicRecording | null>;
  /** Resolve the private R2 object key for a recording, for signed downloads. */
  getFileKey(id: string): Promise<string | null>;
}

class InMemoryRecordingRepository implements RecordingRepository {
  async list(query: RecordingQueryInput): Promise<Paginated<PublicRecording>> {
    return {
      data: [],
      total: 0,
      page: query.page,
      limit: query.limit,
      hasMore: false,
    };
  }

  async findById(_id: string): Promise<PublicRecording | null> {
    return null;
  }

  async getFileKey(_id: string): Promise<string | null> {
    return null;
  }
}

export const recordingRepository: RecordingRepository = new InMemoryRecordingRepository();
