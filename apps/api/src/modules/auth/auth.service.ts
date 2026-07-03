/**
 * Auth service (ARCHITECTURE.md §8 auth flow, §11 security).
 *
 * The full production JWT auth logic, built on injected dependencies so every
 * branch is unit-testable with in-memory fakes and no infrastructure:
 *   • register  — bcrypt(12) hash, create user, issue email-verification token
 *   • login     — verify password, enforce lockout (10 failures → 15m), issue pair
 *   • refresh   — verify + ROTATE the stored refresh token (revoke old, mint new)
 *   • logout    — blacklist the access token's jti, revoke all refresh tokens
 *   • verifyEmail / forgotPassword / resetPassword — one-time hashed tokens
 *
 * Refresh and verification tokens are persisted only as SHA-256 hashes (§11).
 */

import type { AuthTokens, PublicUser } from '@sma/types';
import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from '@sma/validators';
import { AppError, badRequest, unauthorized } from '@/shared/errors/AppError';
import { sha256Hex, randomToken } from '@/shared/crypto';
import type { TokenBlacklist } from '@/shared/auth/tokenBlacklist';
import { tokenBlacklist } from '@/shared/auth/tokenBlacklist';
import type { EmailService } from '@/shared/email/emailService';
import { emailService } from '@/shared/email/emailService';
import { hashPassword, verifyPassword } from './password.service';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './token.service';
import {
  toPublicUser,
  userRepository,
  type UserRecord,
  type UserRepository,
} from './user.repository';
import { refreshTokenRepository, type RefreshTokenRepository } from './refreshToken.repository';
import {
  verificationTokenRepository,
  type VerificationTokenRepository,
} from './verificationToken.repository';

export type AuthResult = { user: PublicUser } & AuthTokens;

/** Failed logins allowed before the account is locked (§11). */
export const MAX_FAILED_ATTEMPTS = 10;
/** How long an account stays locked after too many failures. */
const LOCK_DURATION_MS = 15 * 60 * 1000;
/** Refresh-token lifetime (30 days, ARCHITECTURE.md §8). */
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Email-verification / password-reset token lifetimes. */
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

export interface AuthServiceDeps {
  users: UserRepository;
  refreshTokens: RefreshTokenRepository;
  verificationTokens: VerificationTokenRepository;
  blacklist: TokenBlacklist;
  email: EmailService;
}

export interface LogoutParams {
  userId: string;
  /** jti + exp of the access token being logged out (from `req.user`). */
  jti: string;
  exp: number;
}

export function createAuthService(deps: AuthServiceDeps) {
  const { users, refreshTokens, verificationTokens, blacklist, email } = deps;

  /** Issue an access+refresh pair and persist the refresh token's hash. */
  async function issueTokenPair(record: UserRecord): Promise<AuthTokens> {
    const accessToken = signAccessToken(record.id, record.role, record.emailVerified);
    const refreshToken = signRefreshToken(record.id);
    await refreshTokens.create(
      record.id,
      sha256Hex(refreshToken),
      new Date(Date.now() + REFRESH_TTL_MS),
    );
    return { accessToken, refreshToken };
  }

  async function register(input: RegisterInput): Promise<AuthResult> {
    const existing = await users.findByEmail(input.email);
    if (existing) {
      throw badRequest('AUTH_EMAIL_TAKEN', 'An account with this email already exists');
    }
    const passwordHash = await hashPassword(input.password);
    const record = await users.create({
      email: input.email,
      passwordHash,
      displayName: input.displayName,
      language: input.language ?? 'so',
    });

    // Issue and email a one-time verification token (raw token only in the email).
    const rawToken = randomToken();
    await verificationTokens.create(
      record.id,
      sha256Hex(rawToken),
      'email_verify',
      new Date(Date.now() + VERIFY_TTL_MS),
    );
    await email.sendVerificationEmail(record.email, rawToken);

    const tokens = await issueTokenPair(record);
    return { user: toPublicUser(record), ...tokens };
  }

  async function login(input: LoginInput): Promise<AuthResult> {
    const record = await users.findByEmail(input.email);
    if (!record) {
      throw unauthorized('AUTH_INVALID_CREDENTIALS', 'Invalid email or password');
    }
    if (record.lockedUntil && record.lockedUntil.getTime() > Date.now()) {
      throw new AppError(
        403,
        'AUTH_ACCOUNT_LOCKED',
        'Account temporarily locked due to too many failed attempts. Try again later.',
      );
    }

    const ok = await verifyPassword(input.password, record.passwordHash);
    if (!ok) {
      const attempts = await users.incrementFailedAttempts(record.id);
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        await users.lockUntil(record.id, new Date(Date.now() + LOCK_DURATION_MS));
        throw new AppError(
          403,
          'AUTH_ACCOUNT_LOCKED',
          'Too many failed attempts. Your account is locked for 15 minutes.',
        );
      }
      throw unauthorized('AUTH_INVALID_CREDENTIALS', 'Invalid email or password');
    }

    await users.resetFailedAttempts(record.id);
    await users.touchLastLogin(record.id);
    const tokens = await issueTokenPair(record);
    return { user: toPublicUser(record), ...tokens };
  }

  async function refresh(refreshToken: string): Promise<AuthTokens> {
    const payload = verifyRefreshToken(refreshToken);
    const stored = await refreshTokens.findActive(payload.sub, sha256Hex(refreshToken));
    if (!stored) {
      // Valid signature but not an active stored token → already rotated, revoked,
      // or replayed. Reject; the client must sign in again.
      throw unauthorized('AUTH_INVALID_TOKEN', 'Refresh token is no longer valid');
    }
    // Rotate: revoke the presented token before minting its replacement.
    await refreshTokens.revoke(stored.id);

    const record = await users.findById(payload.sub);
    if (!record) {
      throw unauthorized('AUTH_INVALID_TOKEN', 'Account no longer exists');
    }
    return issueTokenPair(record);
  }

  async function logout(params: LogoutParams): Promise<void> {
    const ttl = Math.max(0, params.exp - Math.floor(Date.now() / 1000));
    await blacklist.add(params.jti, ttl);
    // Full logout: invalidate every refresh token for the user.
    await refreshTokens.revokeAllForUser(params.userId);
  }

  async function verifyEmail(input: VerifyEmailInput): Promise<void> {
    const stored = await verificationTokens.findValid(sha256Hex(input.token), 'email_verify');
    if (!stored) {
      throw badRequest('VALIDATION_ERROR', 'Invalid or expired verification token');
    }
    await users.markEmailVerified(stored.userId);
    await verificationTokens.consume(stored.id);
  }

  async function forgotPassword(input: ForgotPasswordInput): Promise<void> {
    const record = await users.findByEmail(input.email);
    // Silently succeed when the email is unknown (no account enumeration, §11).
    if (record) {
      const rawToken = randomToken();
      await verificationTokens.create(
        record.id,
        sha256Hex(rawToken),
        'password_reset',
        new Date(Date.now() + RESET_TTL_MS),
      );
      await email.sendPasswordResetEmail(record.email, rawToken);
    }
  }

  async function resetPassword(input: ResetPasswordInput): Promise<void> {
    const stored = await verificationTokens.findValid(sha256Hex(input.token), 'password_reset');
    if (!stored) {
      throw badRequest('VALIDATION_ERROR', 'Invalid or expired reset token');
    }
    const passwordHash = await hashPassword(input.newPassword);
    await users.updatePassword(stored.userId, passwordHash);
    await verificationTokens.consume(stored.id);
    // A password change invalidates all existing sessions.
    await refreshTokens.revokeAllForUser(stored.userId);
  }

  async function getCurrentUser(userId: string): Promise<PublicUser> {
    const record = await users.findById(userId);
    if (!record) {
      throw unauthorized('AUTH_INVALID_TOKEN', 'Account no longer exists');
    }
    return toPublicUser(record);
  }

  return {
    register,
    login,
    refresh,
    logout,
    verifyEmail,
    forgotPassword,
    resetPassword,
    getCurrentUser,
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

/** Process-wide auth service composed with the default (in-memory) dependencies.
 * Swap the constructions for Prisma/Redis/Resend implementations in production. */
export const authService: AuthService = createAuthService({
  users: userRepository,
  refreshTokens: refreshTokenRepository,
  verificationTokens: verificationTokenRepository,
  blacklist: tokenBlacklist,
  email: emailService,
});
