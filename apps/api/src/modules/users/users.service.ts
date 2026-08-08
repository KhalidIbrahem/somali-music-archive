/**
 * Users service (ARCHITECTURE.md §12 USERS): profile read/update and saved
 * recordings. Injected repositories (ADR-0005) so it is unit-testable without a DB.
 * Saved-recording ids are hydrated into full public recordings for the client.
 */

import type { Paginated, PublicRecording, PublicUser, UserRole } from '@sma/types';
import type { ListUsersQuery, UpdateProfileInput } from '@sma/validators';
import { badRequest, forbidden, notFound } from '@/shared/errors/AppError';
import { toPublicUser, userRepository, type UserRepository } from '@/modules/auth/user.repository';
import {
  refreshTokenRepository,
  type RefreshTokenRepository,
} from '@/modules/auth/refreshToken.repository';
import {
  recordingRepository,
  type RecordingRepository,
} from '@/modules/recordings/recordings.repository';

export function createUsersService(deps: {
  users: UserRepository;
  recordings: RecordingRepository;
  refreshTokens: RefreshTokenRepository;
}) {
  const { users, recordings, refreshTokens } = deps;

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

  // ── Admin: member management (SESSION "teaching" — granting educator) ────────

  async function listUsers(query: ListUsersQuery): Promise<Paginated<PublicUser>> {
    const { users: rows, total } = await users.listUsers({
      page: query.page,
      limit: query.limit,
      q: query.q,
    });
    return {
      data: rows.map(toPublicUser),
      total,
      page: query.page,
      limit: query.limit,
      hasMore: query.page * query.limit < total,
    };
  }

  /** Change a member's role. Admins cannot change their OWN role — that path
   * removes the last admin by accident; another admin must do it. */
  async function changeRole(
    actorId: string,
    targetUserId: string,
    role: UserRole,
  ): Promise<PublicUser> {
    if (actorId === targetUserId) {
      throw badRequest('VALIDATION_ERROR', 'You cannot change your own role');
    }
    const updated = await users.updateRole(targetUserId, role);
    if (!updated) throw notFound('USER_NOT_FOUND', 'User not found');
    return toPublicUser(updated);
  }

  /**
   * Remove a member (SESSION "private access"). SOFT delete (Principle 4) plus
   * refresh-token revocation, so the account stops working within the access
   * token's 15-minute lifetime. Admins cannot remove themselves, and removing
   * another admin requires demoting them first — one deliberate extra step
   * before an account with full power disappears.
   */
  async function removeUser(actorId: string, targetUserId: string): Promise<void> {
    if (actorId === targetUserId) {
      throw badRequest('VALIDATION_ERROR', 'You cannot remove your own account');
    }
    const target = await users.findById(targetUserId);
    if (!target) throw notFound('USER_NOT_FOUND', 'User not found');
    if (target.role === 'admin') {
      throw forbidden('Demote this admin to another role before removing the account');
    }
    await users.softDelete(targetUserId);
    await refreshTokens.revokeAllForUser(targetUserId);
  }

  return {
    getProfile,
    updateProfile,
    listSaved,
    saveRecording,
    unsaveRecording,
    listUsers,
    changeRole,
    removeUser,
  };
}

export type UsersService = ReturnType<typeof createUsersService>;

export const usersService: UsersService = createUsersService({
  users: userRepository,
  recordings: recordingRepository,
  refreshTokens: refreshTokenRepository,
});
