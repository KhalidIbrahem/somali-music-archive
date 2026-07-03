import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RegisterInput } from '@sma/validators';
import type { EmailService } from '@/shared/email/emailService';
import { AppError } from '@/shared/errors/AppError';
import { InMemoryTokenBlacklist } from '@/shared/auth/tokenBlacklist';
import { InMemoryUserRepository } from './user.repository';
import { InMemoryRefreshTokenRepository } from './refreshToken.repository';
import { InMemoryVerificationTokenRepository } from './verificationToken.repository';
import { verifyAccessToken } from './token.service';
import { createAuthService, MAX_FAILED_ATTEMPTS, type AuthService } from './auth.service';

const registration: RegisterInput = {
  email: 'elder@example.com',
  password: 'oudwood7',
  displayName: 'Ahmed Ali Egal',
  dateOfBirth: '1950-01-01',
  acceptedTerms: true,
};

interface Harness {
  service: AuthService;
  users: InMemoryUserRepository;
  refreshTokens: InMemoryRefreshTokenRepository;
  blacklist: InMemoryTokenBlacklist;
  email: EmailService;
}

function makeHarness(): Harness {
  const users = new InMemoryUserRepository();
  const refreshTokens = new InMemoryRefreshTokenRepository();
  const verificationTokens = new InMemoryVerificationTokenRepository();
  const blacklist = new InMemoryTokenBlacklist();
  const email: EmailService = {
    sendVerificationEmail: vi.fn(async () => {}),
    sendPasswordResetEmail: vi.fn(async () => {}),
  };
  const service = createAuthService({ users, refreshTokens, verificationTokens, blacklist, email });
  return { service, users, refreshTokens, blacklist, email };
}

let h: Harness;
beforeEach(() => {
  h = makeHarness();
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
