import { describe, it, expect, beforeEach } from 'vitest';
import { AppError } from '@/shared/errors/AppError';
import { InMemoryUserRepository } from '@/modules/auth/user.repository';
import { InMemoryRefreshTokenRepository } from '@/modules/auth/refreshToken.repository';
import { InMemoryRecordingRepository } from '@/modules/recordings/recordings.repository';
import { createUsersService, type UsersService } from './users.service';

let users: InMemoryUserRepository;
let recordings: InMemoryRecordingRepository;
let refreshTokens: InMemoryRefreshTokenRepository;
let service: UsersService;
let userId: string;

beforeEach(async () => {
  users = new InMemoryUserRepository();
  recordings = new InMemoryRecordingRepository();
  refreshTokens = new InMemoryRefreshTokenRepository();
  service = createUsersService({ users, recordings, refreshTokens });
  const user = await users.create({
    email: 'elder@example.com',
    passwordHash: 'x',
    displayName: 'Ahmed',
    language: 'so',
  });
  userId = user.id;
});

async function completedRecording(): Promise<string> {
  const { recordingId } = await recordings.createDraft({
    fileKey: 'k',
    format: 'wav',
    sessionId: 's',
  });
  await recordings.complete(recordingId, {
    title: { somali: 'Balwo' },
    singerName: 'Test Artist',
    genre: 'qaraami',
    instruments: ['voice'],
  });
  return recordingId;
}

describe('updateProfile', () => {
  it('updates editable fields and returns the public user', async () => {
    const updated = await service.updateProfile(userId, {
      displayName: 'Test Artist',
      language: 'en',
    });
    expect(updated.displayName).toBe('Test Artist');
    expect(updated.language).toBe('en');
  });

  it('throws USER_NOT_FOUND for an unknown user', async () => {
    await expect(service.updateProfile('nope', { displayName: 'x' })).rejects.toBeInstanceOf(
      AppError,
    );
  });
});

describe('saved recordings', () => {
  it('saves, lists (hydrated), and unsaves', async () => {
    const recordingId = await completedRecording();

    await service.saveRecording(userId, recordingId);
    const saved = await service.listSaved(userId);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.title.somali).toBe('Balwo');

    await service.unsaveRecording(userId, recordingId);
    expect(await service.listSaved(userId)).toHaveLength(0);
  });

  it('drops saved ids that no longer resolve to a recording', async () => {
    await service.saveRecording(userId, 'a'.repeat(24));
    expect(await service.listSaved(userId)).toHaveLength(0);
  });

  it('is idempotent when saving the same recording twice', async () => {
    const recordingId = await completedRecording();
    await service.saveRecording(userId, recordingId);
    await service.saveRecording(userId, recordingId);
    expect(await service.listSaved(userId)).toHaveLength(1);
  });
});

describe('admin member management', () => {
  it('lists users newest-first with a search filter', async () => {
    await users.create({
      email: 'professor@university.edu',
      passwordHash: 'x',
      displayName: 'Guest Professor',
      language: 'en',
    });
    const all = await service.listUsers({ page: 1, limit: 20 });
    expect(all.total).toBe(2);
    const filtered = await service.listUsers({ page: 1, limit: 20, q: 'professor' });
    expect(filtered.total).toBe(1);
    expect(filtered.data[0]?.email).toBe('professor@university.edu');
  });

  it('changes a role (listener → educator) but never the actor’s own', async () => {
    const professor = await users.create({
      email: 'professor@university.edu',
      passwordHash: 'x',
      displayName: 'Guest Professor',
      language: 'en',
    });
    const promoted = await service.changeRole(userId, professor.id, 'educator');
    expect(promoted.role).toBe('educator');
    await expect(service.changeRole(userId, userId, 'listener')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('throws USER_NOT_FOUND when the target does not exist', async () => {
    await expect(service.changeRole(userId, 'missing-id', 'educator')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
  });
});

describe('removeUser (SESSION "private access")', () => {
  it('soft-deletes a member and revokes their refresh tokens', async () => {
    const member = await users.create({
      email: 'guest@example.com',
      passwordHash: 'x',
      displayName: 'Guest',
      language: 'en',
    });
    await refreshTokens.create(member.id, 'hash', new Date(Date.now() + 1000));
    await service.removeUser(userId, member.id);
    expect(await users.findById(member.id)).toBeNull();
    expect(await refreshTokens.findActive(member.id, 'hash')).toBeNull();
  });

  it('refuses to remove yourself or another admin', async () => {
    await expect(service.removeUser(userId, userId)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    const otherAdmin = await users.create({
      email: 'admin2@example.com',
      passwordHash: 'x',
      displayName: 'Second Admin',
      language: 'so',
      role: 'admin',
    });
    await expect(service.removeUser(userId, otherAdmin.id)).rejects.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });
});
