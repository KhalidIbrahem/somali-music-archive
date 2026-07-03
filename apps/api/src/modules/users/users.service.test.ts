import { describe, it, expect, beforeEach } from 'vitest';
import { AppError } from '@/shared/errors/AppError';
import { InMemoryUserRepository } from '@/modules/auth/user.repository';
import { InMemoryRecordingRepository } from '@/modules/recordings/recordings.repository';
import { createUsersService, type UsersService } from './users.service';

let users: InMemoryUserRepository;
let recordings: InMemoryRecordingRepository;
let service: UsersService;
let userId: string;

beforeEach(async () => {
  users = new InMemoryUserRepository();
  recordings = new InMemoryRecordingRepository();
  service = createUsersService({ users, recordings });
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
    singerName: 'Ahmed Ali Egal',
    genre: 'qaraami',
    instruments: ['voice'],
  });
  return recordingId;
}

describe('updateProfile', () => {
  it('updates editable fields and returns the public user', async () => {
    const updated = await service.updateProfile(userId, {
      displayName: 'Ahmed Ali Egal',
      language: 'en',
    });
    expect(updated.displayName).toBe('Ahmed Ali Egal');
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
