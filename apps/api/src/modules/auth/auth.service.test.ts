import { describe, it, expect, beforeEach } from 'vitest';
import { register, login, refresh } from './auth.service';
import { InMemoryUserRepository, type UserRepository } from './user.repository';
import { AppError } from '@/shared/errors/AppError';
import type { RegisterInput } from '@sma/validators';

const baseInput: RegisterInput = {
  email: 'elder@example.com',
  password: 'oudwood7',
  displayName: 'Ahmed Ali Egal',
  dateOfBirth: '1950-01-01',
  acceptedTerms: true,
};

describe('auth.service', () => {
  let repo: UserRepository;

  beforeEach(() => {
    repo = new InMemoryUserRepository();
  });

  it('registers a new user and returns tokens without leaking the password', async () => {
    const result = await register(repo, baseInput);
    expect(result.user.email).toBe('elder@example.com');
    expect(result.user.role).toBe('listener');
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    // The public user must not carry any hash/secret field.
    expect(JSON.stringify(result.user)).not.toContain('passwordHash');
  });

  it('rejects a duplicate email', async () => {
    await register(repo, baseInput);
    await expect(register(repo, baseInput)).rejects.toBeInstanceOf(AppError);
  });

  it('logs in with correct credentials', async () => {
    await register(repo, baseInput);
    const result = await login(repo, { email: baseInput.email, password: baseInput.password });
    expect(result.user.email).toBe('elder@example.com');
    expect(result.accessToken).toBeTruthy();
  });

  it('rejects login with a wrong password', async () => {
    await register(repo, baseInput);
    await expect(
      login(repo, { email: baseInput.email, password: 'nope1234' }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects login for an unknown email', async () => {
    await expect(
      login(repo, { email: 'ghost@example.com', password: 'whatever1' }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('issues fresh tokens from a valid refresh token', async () => {
    const registered = await register(repo, baseInput);
    const tokens = await refresh(repo, registered.refreshToken);
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
  });
});
