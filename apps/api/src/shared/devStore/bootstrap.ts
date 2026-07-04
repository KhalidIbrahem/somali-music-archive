/**
 * Boot-time hydration of the local dev seed store (SESSION "seed data").
 *
 * Called once from the server entry point: if a dev store exists and we are not in
 * production, load the seeded users and recordings into the in-memory repository
 * singletons so a freshly started API looks seeded. Published recordings are also
 * pushed into the search index, so full-text search works on the seed data too.
 *
 * Guarded three ways — never runs in production, is a no-op when nothing has been
 * seeded, and only touches repositories that are actually the in-memory kind (so
 * it becomes inert automatically once DB-backed repositories replace them).
 */

import { env } from '@/config/env';
import { logger } from '@/shared/logger';
import { InMemoryUserRepository, userRepository } from '@/modules/auth/user.repository';
import {
  InMemoryRecordingRepository,
  recordingRepository,
} from '@/modules/recordings/recordings.repository';
import { searchIndex, toSearchDocument } from '@/modules/search/searchIndex';
import { loadDevStore } from './devStore';

export async function hydrateFromDevStore(): Promise<void> {
  if (env.NODE_ENV === 'production') return;

  const data = loadDevStore();
  if (!data) return;

  if (userRepository instanceof InMemoryUserRepository) {
    userRepository.hydrate(data.users);
  }

  if (recordingRepository instanceof InMemoryRecordingRepository) {
    recordingRepository.hydrate(data.recordings);
    // Rebuild the search index for the published archive (§12 — the index only
    // ever holds published recordings; it is repopulated on publish at runtime).
    for (const doc of data.recordings) {
      const recording = await recordingRepository.findById(doc.id);
      if (recording && recording.status === 'published') {
        await searchIndex.index(toSearchDocument(recording));
      }
    }
  }

  logger.info(
    { users: data.users.length, recordings: data.recordings.length },
    'Hydrated in-memory repositories from dev seed store',
  );
}
