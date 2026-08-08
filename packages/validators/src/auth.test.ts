import { describe, it, expect } from 'vitest';
import { registerSchema, loginSchema, resetPasswordSchema, MIN_SIGNUP_AGE } from './auth';

/** A date-of-birth `years` years before today, as YYYY-MM-DD. */
function dobYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  const iso = d.toISOString().slice(0, 10);
  return iso;
}

describe('registerSchema', () => {
  const valid = {
    inviteCode: 'qg-test-2026',
    username: 'Elder_1950',
    email: 'Elder@Example.com ',
    password: 'oudwood7',
    displayName: 'Test Artist',
    dateOfBirth: dobYearsAgo(40),
    acceptedTerms: true as const,
  };

  it('accepts a valid registration, normalising email, username, and invite code', () => {
    const parsed = registerSchema.parse(valid);
    expect(parsed.email).toBe('elder@example.com');
    expect(parsed.username).toBe('elder_1950');
    expect(parsed.inviteCode).toBe('QG-TEST-2026');
  });

  it('requires an invite code (the platform is invite-only)', () => {
    const { inviteCode: _dropped, ...withoutCode } = valid;
    expect(registerSchema.safeParse(withoutCode).success).toBe(false);
  });

  it('rejects malformed usernames', () => {
    for (const username of ['ab', '1starts.with.digit', 'has space', 'x'.repeat(25), 'a@b']) {
      expect(registerSchema.safeParse({ ...valid, username }).success).toBe(false);
    }
  });

  it('rejects a user younger than the COPPA minimum age', () => {
    const result = registerSchema.safeParse({
      ...valid,
      dateOfBirth: dobYearsAgo(MIN_SIGNUP_AGE - 1),
    });
    expect(result.success).toBe(false);
  });

  it('rejects a password with no digit', () => {
    const result = registerSchema.safeParse({ ...valid, password: 'oudwoodpass' });
    expect(result.success).toBe(false);
  });

  it('requires terms acceptance to be exactly true', () => {
    const result = registerSchema.safeParse({ ...valid, acceptedTerms: false });
    expect(result.success).toBe(false);
  });
});

describe('registerSchema phone', () => {
  const valid = {
    inviteCode: 'QG-TEST-2026',
    username: 'member',
    email: 'member@example.com',
    password: 'oudwood7',
    displayName: 'Test Artist',
    dateOfBirth: dobYearsAgo(40),
    acceptedTerms: true as const,
  };

  it('is optional', () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  it('normalises spaces, dashes and 00-prefix to E.164', () => {
    const parsed = registerSchema.parse({ ...valid, phone: '00252 61-234 5678' });
    expect(parsed.phone).toBe('+252612345678');
  });

  it('rejects a local number without a country code', () => {
    const result = registerSchema.safeParse({ ...valid, phone: '0612345678' });
    expect(result.success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('does not enforce the full password policy (legacy passwords must still log in)', () => {
    const result = loginSchema.safeParse({ email: 'a@b.co', password: 'x' });
    expect(result.success).toBe(true);
  });

  it('accepts an identifier (email or phone) instead of email', () => {
    expect(loginSchema.safeParse({ identifier: '+252612345678', password: 'x' }).success).toBe(
      true,
    );
    expect(loginSchema.safeParse({ identifier: 'a@b.co', password: 'x' }).success).toBe(true);
  });

  it('rejects both email and identifier together, and neither', () => {
    expect(
      loginSchema.safeParse({ email: 'a@b.co', identifier: 'a@b.co', password: 'x' }).success,
    ).toBe(false);
    expect(loginSchema.safeParse({ password: 'x' }).success).toBe(false);
  });
});

describe('resetPasswordSchema', () => {
  it('enforces the password policy on the new password', () => {
    const weak = resetPasswordSchema.safeParse({ token: 't', newPassword: 'short' });
    expect(weak.success).toBe(false);
  });
});
