/**
 * Auth service (ARCHITECTURE.md §8 auth flow, §11 security).
 *
 * Pure-ish business logic that depends on an injected `UserRepository`, the
 * password service (bcrypt 12 rounds), and the token service (JWT). Keeping the
 * repository injected makes every function unit-testable with the in-memory repo
 * and with no network/database.
 *
 * NOTE (Phase 1): refresh-token rotation currently re-issues a fresh pair on a
 * valid refresh JWT. The full design also persists a bcrypt hash of each refresh
 * token in `refresh_tokens` and blacklists revoked access tokens in Redis (§11);
 * those stores plug in here without changing the signatures below.
 */

import type { AuthTokens, PublicUser } from '@sma/types';
import type { LoginInput, RegisterInput } from '@sma/validators';
import { badRequest, unauthorized } from '@/shared/errors/AppError';
import { hashPassword, verifyPassword } from './password.service';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './token.service';
import { toPublicUser, type UserRepository } from './user.repository';

export type AuthResult = { user: PublicUser } & AuthTokens;

function issueTokens(userId: string, role: PublicUser['role']): AuthTokens {
  return {
    accessToken: signAccessToken(userId, role),
    refreshToken: signRefreshToken(userId),
  };
}

export async function register(repo: UserRepository, input: RegisterInput): Promise<AuthResult> {
  const existing = await repo.findByEmail(input.email);
  if (existing) {
    // 409-style conflict, surfaced with a machine-readable code.
    throw badRequest('AUTH_EMAIL_TAKEN', 'An account with this email already exists');
  }
  const passwordHash = await hashPassword(input.password);
  const record = await repo.create({
    email: input.email,
    passwordHash,
    displayName: input.displayName,
    language: input.language ?? 'so',
  });
  const user = toPublicUser(record);
  return { user, ...issueTokens(record.id, record.role) };
}

export async function login(repo: UserRepository, input: LoginInput): Promise<AuthResult> {
  const record = await repo.findByEmail(input.email);
  // Always run a hash comparison shape even when the user is missing would be
  // ideal to avoid timing oracles; bcrypt.compare on a dummy is deferred to
  // Phase 1. For now, a missing user and a bad password return the same error.
  if (!record) {
    throw unauthorized('AUTH_INVALID_CREDENTIALS', 'Invalid email or password');
  }
  const ok = await verifyPassword(input.password, record.passwordHash);
  if (!ok) {
    throw unauthorized('AUTH_INVALID_CREDENTIALS', 'Invalid email or password');
  }
  await repo.touchLastLogin(record.id);
  const user = toPublicUser(record);
  return { user, ...issueTokens(record.id, record.role) };
}

export async function refresh(repo: UserRepository, refreshToken: string): Promise<AuthTokens> {
  const payload = verifyRefreshToken(refreshToken);
  const record = await repo.findById(payload.sub);
  if (!record) {
    throw unauthorized('AUTH_INVALID_TOKEN', 'Account no longer exists');
  }
  return issueTokens(record.id, record.role);
}

export async function getCurrentUser(repo: UserRepository, userId: string): Promise<PublicUser> {
  const record = await repo.findById(userId);
  if (!record) {
    throw unauthorized('AUTH_INVALID_TOKEN', 'Account no longer exists');
  }
  return toPublicUser(record);
}
