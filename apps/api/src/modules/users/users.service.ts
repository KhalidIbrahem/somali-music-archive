/**
 * Users service (ARCHITECTURE.md §12 USERS): profile read/update and saved
 * recordings. Injected repositories (ADR-0005) so it is unit-testable without a DB.
 * Saved-recording ids are hydrated into full public recordings for the client.
 */

import type { PublicRecording, PublicUser } from '@sma/types';
import type { UpdateProfileInput } from '@sma/validators';
import { notFound } from '@/shared/errors/AppError';
import { toPublicUser, userRepository, type UserRepository } from '@/modules/auth/user.repository';
import {
  recordingRepository,
  type RecordingRepository,
} from '@/modules/recordings/recordings.repository';

export function createUsersService(deps: {
  users: UserRepository;
  recordings: RecordingRepository;
}) {
  const { users, recordings } = deps;

  async function getProfile(userId: string): Promise<PublicUser> {
    const record = await users.findById(userId);
    if (!record) throw notFound('USER_NOT_FOUND', 'User not found');
    return toPublicUser(record);
  }

  async function updateProfile(userId: string, patch: UpdateProfileInput): Promise<PublicUser> {
    const updated = await users.updateProfile(userId, patch);
    if (!updated) throw notFound('USER_NOT_FOUND', 'User not found');
    return toPublicUser(updated);
  }

  async function listSaved(userId: string): Promise<PublicRecording[]> {
    const ids = await users.listSaved(userId);
    const recordingsList = await Promise.all(ids.map((id) => recordings.findById(id)));
    // Drop any that were removed/soft-deleted since being saved.
    return recordingsList.filter((r): r is PublicRecording => r !== null);
  }

  async function saveRecording(userId: string, recordingId: string): Promise<void> {
    await users.addSaved(userId, recordingId);
  }

  async function unsaveRecording(userId: string, recordingId: string): Promise<void> {
    await users.removeSaved(userId, recordingId);
  }

  return { getProfile, updateProfile, listSaved, saveRecording, unsaveRecording };
}

export type UsersService = ReturnType<typeof createUsersService>;

export const usersService: UsersService = createUsersService({
  users: userRepository,
  recordings: recordingRepository,
});
