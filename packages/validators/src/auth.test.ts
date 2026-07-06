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
    email: 'Elder@Example.com ',
    password: 'oudwood7',
    displayName: 'Ahmed Ali Egal',
    dateOfBirth: dobYearsAgo(40),
    acceptedTerms: true as const,
  };

  it('accepts a valid registration and normalises the email', () => {
    const parsed = registerSchema.parse(valid);
    expect(parsed.email).toBe('elder@example.com');
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

describe('loginSchema', () => {
  it('does not enforce the full password policy (legacy passwords must still log in)', () => {
    const result = loginSchema.safeParse({ email: 'a@b.co', password: 'x' });
    expect(result.success).toBe(true);
  });
});

describe('resetPasswordSchema', () => {
  it('enforces the password policy on the new password', () => {
    const weak = resetPasswordSchema.safeParse({ token: 't', newPassword: 'short' });
    expect(weak.success).toBe(false);
  });
});
