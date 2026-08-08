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
  GoogleAuthInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from '@sma/validators';
import { E164_PATTERN, normalizePhone } from '@sma/validators';
import { AppError, badRequest, unauthorized } from '@/shared/errors/AppError';
import { sha256Hex, randomToken } from '@/shared/crypto';
import type { TokenBlacklist } from '@/shared/auth/tokenBlacklist';
import { tokenBlacklist } from '@/shared/auth/tokenBlacklist';
import type { EmailService } from '@/shared/email/emailService';
import { emailService } from '@/shared/email/emailService';
import { invitesService } from '@/modules/invites/invites.service';
import { hashPassword, verifyPassword } from './password.service';
import { verifyGoogleCredential, type GoogleIdentityVerifier } from './google.verifier';
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
  /** Verifies a Google ID-token credential (injected so tests need no network). */
  googleIdentity: GoogleIdentityVerifier;
  /** Invite gate (SESSION "private access") — registration burns one code use. */
  invites: {
    checkCode(code: string): Promise<{ id: string }>;
    redeemFor(codeId: string, userId: string): Promise<boolean>;
  };
}

export interface LogoutParams {
  userId: string;
  /** jti + exp of the access token being logged out (from `req.user`). */
  jti: string;
  exp: number;
}

export function createAuthService(deps: AuthServiceDeps) {
  const { users, refreshTokens, verificationTokens, blacklist, email, googleIdentity, invites } =
    deps;

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
    // Invite gate first — no other detail (email taken, …) leaks to someone
    // holding no valid code. Throws AUTH_INVITE_INVALID with the reason.
    const invite = await invites.checkCode(input.inviteCode);

    const existing = await users.findByEmail(input.email);
    if (existing) {
      throw badRequest('AUTH_EMAIL_TAKEN', 'An account with this email already exists');
    }
    const usernameTaken = await users.findByUsername(input.username);
    if (usernameTaken) {
      throw badRequest('AUTH_USERNAME_TAKEN', 'This username is already taken');
    }
    if (input.phone !== undefined) {
      const phoneTaken = await users.findByPhone(input.phone);
      if (phoneTaken) {
        throw badRequest('AUTH_PHONE_TAKEN', 'An account with this phone number already exists');
      }
    }
    const passwordHash = await hashPassword(input.password);
    const record = await users.create({
      email: input.email,
      username: input.username,
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      passwordHash,
      displayName: input.displayName,
      language: input.language ?? 'so',
    });

    // Burn one use, tied to the new account. A lost race (the code's last use
    // claimed between check and redeem) rolls the account back.
    const redeemed = await invites.redeemFor(invite.id, record.id);
    if (!redeemed) {
      await users.softDelete(record.id);
      throw badRequest(
        'AUTH_INVITE_INVALID',
        'This invite code was just used up — ask for a new one',
      );
    }

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

  /**
   * Resolve a login identifier to a user. `email` (legacy shape) and identifiers
   * containing `@` are email lookups; phone-shaped identifiers (E.164 after
   * normalisation) are phone lookups; everything else is a username. Usernames
   * must start with a letter (usernameSchema), so the two spaces cannot collide.
   * The schema guarantees exactly one of email/identifier is present.
   */
  async function findByIdentifier(input: LoginInput): Promise<UserRecord | null> {
    if (input.email !== undefined) return users.findByEmail(input.email);
    const identifier = input.identifier ?? '';
    if (identifier.includes('@')) return users.findByEmail(identifier.toLowerCase());
    const phone = normalizePhone(identifier);
    if (E164_PATTERN.test(phone)) return users.findByPhone(phone);
    return users.findByUsername(identifier.toLowerCase());
  }

  async function login(input: LoginInput): Promise<AuthResult> {
    const record = await findByIdentifier(input);
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

  /**
   * Sign in (or sign up) with a verified Google credential. Accounts are linked
   * by email: an existing member signs straight in; a new visitor gets an
   * account whose email Google has already verified. Google-created accounts
   * receive an unguessable random password hash — password login stays unusable
   * until the member sets one via the reset flow.
   */
  async function loginWithGoogle(input: GoogleAuthInput): Promise<AuthResult> {
    const identity = await googleIdentity(input.credential);
    if (!identity.emailVerified) {
      throw unauthorized(
        'AUTH_INVALID_CREDENTIALS',
        'This Google account has no verified email address',
      );
    }

    let record = await users.findByEmail(identity.email);
    if (!record) {
      // SIGN-IN ONLY on the invite-only platform (SESSION "private access"):
      // a Google identity with no existing account is turned away, never minted
      // one. Members register with their invite code first; after that the
      // Google button is a convenience login.
      throw new AppError(
        403,
        'AUTH_INVITE_REQUIRED',
        'This platform is invite-only. Register with your invite code first — after that, Google sign-in works.',
      );
    }
    if (!record.emailVerified) {
      // Google verified ownership of this exact address — reflect that.
      await users.markEmailVerified(record.id);
      record = (await users.findById(record.id)) ?? record;
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
    loginWithGoogle,
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
  googleIdentity: verifyGoogleCredential,
  invites: invitesService,
});
