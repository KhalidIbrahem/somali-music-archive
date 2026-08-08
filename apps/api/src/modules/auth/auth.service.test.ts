import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RegisterInput } from '@sma/validators';
import type { EmailService } from '@/shared/email/emailService';
import { AppError } from '@/shared/errors/AppError';
import { InMemoryTokenBlacklist } from '@/shared/auth/tokenBlacklist';
import { InMemoryInviteRepository } from '@/modules/invites/invite.repository';
import { createInvitesService } from '@/modules/invites/invites.service';
import type { GoogleIdentity } from './google.verifier';
import { InMemoryUserRepository } from './user.repository';
import { InMemoryRefreshTokenRepository } from './refreshToken.repository';
import { InMemoryVerificationTokenRepository } from './verificationToken.repository';
import { verifyAccessToken } from './token.service';
import { createAuthService, MAX_FAILED_ATTEMPTS, type AuthService } from './auth.service';

/** The harness pre-creates this many-use code; tests mint their own for edge cases. */
const TEST_INVITE = 'QG-TEST-2026';

const registration: RegisterInput = {
  inviteCode: TEST_INVITE,
  username: 'elder',
  email: 'elder@example.com',
  password: 'oudwood7',
  displayName: 'Test Artist',
  dateOfBirth: '1950-01-01',
  acceptedTerms: true,
};

interface Harness {
  service: AuthService;
  users: InMemoryUserRepository;
  refreshTokens: InMemoryRefreshTokenRepository;
  blacklist: InMemoryTokenBlacklist;
  email: EmailService;
  invites: InMemoryInviteRepository;
  /** Mutable per-test Google identity; null → the verifier throws (bad token). */
  google: { identity: GoogleIdentity | null };
}

async function makeHarness(): Promise<Harness> {
  const users = new InMemoryUserRepository();
  const refreshTokens = new InMemoryRefreshTokenRepository();
  const verificationTokens = new InMemoryVerificationTokenRepository();
  const blacklist = new InMemoryTokenBlacklist();
  const email: EmailService = {
    sendVerificationEmail: vi.fn(async () => {}),
    sendPasswordResetEmail: vi.fn(async () => {}),
  };
  const google: Harness['google'] = { identity: null };
  const invites = new InMemoryInviteRepository();
  await invites.create({
    code: TEST_INVITE,
    label: 'test fixture',
    maxUses: 1000,
    expiresAt: null,
    createdById: 'seed-admin',
  });
  const service = createAuthService({
    users,
    refreshTokens,
    verificationTokens,
    blacklist,
    email,
    googleIdentity: async () => {
      if (!google.identity) throw new AppError(401, 'AUTH_INVALID_TOKEN', 'Bad Google credential');
      return google.identity;
    },
    invites: createInvitesService({ invites, users }),
  });
  return { service, users, refreshTokens, blacklist, email, invites, google };
}

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});

describe('register', () => {
  it('creates an unverified user, issues tokens, and sends a verification email', async () => {
    const result = await h.service.register(registration);
    expect(result.user.email).toBe('elder@example.com');
    expect(result.user.emailVerified).toBe(false);
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(h.email.sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it('rejects a duplicate email', async () => {
    await h.service.register(registration);
    await expect(h.service.register(registration)).rejects.toBeInstanceOf(AppError);
  });

  it('stores an E.164 phone and rejects a duplicate phone', async () => {
    const withPhone = { ...registration, phone: '+252612345678' };
    const result = await h.service.register(withPhone);
    expect(result.user.phone).toBe('+252612345678');
    await expect(
      h.service.register({ ...withPhone, email: 'other@example.com', username: 'other' }),
    ).rejects.toMatchObject({ code: 'AUTH_PHONE_TAKEN' });
  });

  it('rejects a duplicate username', async () => {
    await h.service.register(registration);
    await expect(
      h.service.register({ ...registration, email: 'other@example.com' }),
    ).rejects.toMatchObject({ code: 'AUTH_USERNAME_TAKEN' });
  });
});

describe('invite gate (SESSION "private access")', () => {
  it('rejects an unknown code before leaking anything else', async () => {
    await expect(
      h.service.register({ ...registration, inviteCode: 'QG-DOES-NOTEXIST' }),
    ).rejects.toMatchObject({ code: 'AUTH_INVITE_INVALID' });
  });

  it('rejects a revoked code', async () => {
    const code = await h.invites.create({
      code: 'QG-REVO-KED22',
      label: null,
      maxUses: 5,
      expiresAt: null,
      createdById: 'seed-admin',
    });
    await h.invites.revoke(code.id);
    await expect(
      h.service.register({ ...registration, inviteCode: 'QG-REVO-KED22' }),
    ).rejects.toMatchObject({ code: 'AUTH_INVITE_INVALID' });
  });

  it('rejects an expired code', async () => {
    await h.invites.create({
      code: 'QG-EXPI-RED22',
      label: null,
      maxUses: 5,
      expiresAt: new Date(Date.now() - 1000),
      createdById: 'seed-admin',
    });
    await expect(
      h.service.register({ ...registration, inviteCode: 'QG-EXPI-RED22' }),
    ).rejects.toMatchObject({ code: 'AUTH_INVITE_INVALID' });
  });

  it('burns one use per registration and exhausts at maxUses', async () => {
    await h.invites.create({
      code: 'QG-ONEU-SE222',
      label: null,
      maxUses: 1,
      expiresAt: null,
      createdById: 'seed-admin',
    });
    await h.service.register({ ...registration, inviteCode: 'QG-ONEU-SE222' });
    await expect(
      h.service.register({
        ...registration,
        inviteCode: 'QG-ONEU-SE222',
        email: 'second@example.com',
        username: 'second',
      }),
    ).rejects.toMatchObject({ code: 'AUTH_INVITE_INVALID' });
  });

  it('matches codes case-insensitively (stored uppercase)', async () => {
    const result = await h.service.register({
      ...registration,
      inviteCode: TEST_INVITE.toLowerCase() as RegisterInput['inviteCode'],
    });
    expect(result.user.username).toBe('elder');
  });
});

describe('login', () => {
  beforeEach(async () => {
    await h.service.register(registration);
  });

  it('succeeds with correct credentials', async () => {
    const result = await h.service.login({ email: registration.email, password: 'oudwood7' });
    expect(result.user.email).toBe('elder@example.com');
    expect(result.accessToken).toBeTruthy();
  });

  it('rejects a wrong password with INVALID_CREDENTIALS', async () => {
    await expect(
      h.service.login({ email: registration.email, password: 'wrong-password9' }),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
  });

  it('locks the account after too many failed attempts', async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i += 1) {
      await expect(
        h.service.login({ email: registration.email, password: 'wrong-password9' }),
      ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    }
    // The 10th failure trips the lock.
    await expect(
      h.service.login({ email: registration.email, password: 'wrong-password9' }),
    ).rejects.toMatchObject({ code: 'AUTH_ACCOUNT_LOCKED' });
    // Even the correct password is now refused while locked.
    await expect(
      h.service.login({ email: registration.email, password: 'oudwood7' }),
    ).rejects.toMatchObject({ code: 'AUTH_ACCOUNT_LOCKED' });
  });

  it('resets the failure counter after a successful login', async () => {
    await h.service
      .login({ email: registration.email, password: 'wrong-password9' })
      .catch(() => undefined);
    await h.service.login({ email: registration.email, password: 'oudwood7' });
    // A fresh wrong attempt should again be INVALID (not immediately locked).
    await expect(
      h.service.login({ email: registration.email, password: 'wrong-password9' }),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
  });
});

describe('login by identifier (email or phone)', () => {
  beforeEach(async () => {
    await h.service.register({ ...registration, phone: '+252612345678' });
  });

  it('accepts the email as an identifier', async () => {
    const result = await h.service.login({ identifier: 'elder@example.com', password: 'oudwood7' });
    expect(result.user.email).toBe('elder@example.com');
  });

  it('accepts the username as an identifier, case-insensitively', async () => {
    const result = await h.service.login({ identifier: 'Elder', password: 'oudwood7' });
    expect(result.user.username).toBe('elder');
  });

  it('accepts the phone in any reasonable formatting', async () => {
    const result = await h.service.login({
      identifier: '00252 61-234 5678',
      password: 'oudwood7',
    });
    expect(result.user.phone).toBe('+252612345678');
  });

  it('rejects an unknown or malformed phone identifier with INVALID_CREDENTIALS', async () => {
    await expect(
      h.service.login({ identifier: '+252699999999', password: 'oudwood7' }),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    await expect(
      h.service.login({ identifier: 'not-a-phone', password: 'oudwood7' }),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
  });
});

describe('loginWithGoogle', () => {
  it('turns away a Google identity with no account (invite-only platform)', async () => {
    h.google.identity = {
      email: 'stranger@university.edu',
      emailVerified: true,
      name: 'A Stranger',
    };
    await expect(h.service.loginWithGoogle({ credential: 'x'.repeat(32) })).rejects.toMatchObject({
      code: 'AUTH_INVITE_REQUIRED',
    });
  });

  it('links to an existing account by email and marks it verified', async () => {
    const registered = await h.service.register(registration);
    h.google.identity = { email: registration.email, emailVerified: true };
    const result = await h.service.loginWithGoogle({ credential: 'x'.repeat(32) });
    expect(result.user.id).toBe(registered.user.id);
    expect(result.user.emailVerified).toBe(true);
  });

  it('rejects a Google identity whose email is unverified', async () => {
    h.google.identity = { email: 'shady@example.com', emailVerified: false };
    await expect(h.service.loginWithGoogle({ credential: 'x'.repeat(32) })).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });
  });

  it('propagates a failed credential verification', async () => {
    h.google.identity = null;
    await expect(h.service.loginWithGoogle({ credential: 'x'.repeat(32) })).rejects.toMatchObject({
      code: 'AUTH_INVALID_TOKEN',
    });
  });
});

describe('refresh (rotation)', () => {
  it('issues a new pair and revokes the presented refresh token', async () => {
    const { refreshToken } = await h.service.register(registration);
    const rotated = await h.service.refresh(refreshToken);
    expect(rotated.accessToken).toBeTruthy();
    expect(rotated.refreshToken).not.toBe(refreshToken);
    // Reusing the now-rotated token must fail (replay protection).
    await expect(h.service.refresh(refreshToken)).rejects.toMatchObject({
      code: 'AUTH_INVALID_TOKEN',
    });
  });
});

describe('logout', () => {
  it('blacklists the access token and revokes refresh tokens', async () => {
    const { accessToken, refreshToken } = await h.service.register(registration);
    const payload = verifyAccessToken(accessToken);

    await h.service.logout({ userId: payload.sub, jti: payload.jti, exp: payload.exp });

    expect(await h.blacklist.has(payload.jti)).toBe(true);
    await expect(h.service.refresh(refreshToken)).rejects.toBeInstanceOf(AppError);
  });
});

describe('email verification', () => {
  it('marks the user verified with a valid token', async () => {
    const { user } = await h.service.register(registration);
    const call = vi.mocked(h.email.sendVerificationEmail).mock.calls[0];
    expect(call).toBeDefined();
    const rawToken = call![1];

    await h.service.verifyEmail({ token: rawToken });

    const refreshed = await h.service.getCurrentUser(user.id);
    expect(refreshed.emailVerified).toBe(true);
  });

  it('rejects an unknown verification token', async () => {
    await h.service.register(registration);
    await expect(h.service.verifyEmail({ token: 'nope' })).rejects.toBeInstanceOf(AppError);
  });
});

describe('password reset', () => {
  it('resets the password and invalidates the old one', async () => {
    await h.service.register(registration);
    await h.service.forgotPassword({ email: registration.email });
    const call = vi.mocked(h.email.sendPasswordResetEmail).mock.calls[0];
    expect(call).toBeDefined();
    const resetToken = call![1];

    await h.service.resetPassword({ token: resetToken, newPassword: 'newpass99' });

    await expect(
      h.service.login({ email: registration.email, password: 'oudwood7' }),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    const result = await h.service.login({ email: registration.email, password: 'newpass99' });
    expect(result.accessToken).toBeTruthy();
  });

  it('forgotPassword resolves silently for an unknown email (no enumeration)', async () => {
    await expect(h.service.forgotPassword({ email: 'ghost@example.com' })).resolves.toBeUndefined();
    expect(h.email.sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});
