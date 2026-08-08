/**
 * Auth input schemas (ARCHITECTURE.md §12 AUTH, §11 Security).
 *
 * These guard the highest-value endpoints on the platform. The COPPA age gate on
 * registration is enforced here (§11 Compliance — users under 13 not permitted).
 */

import { z } from 'zod';
import {
  emailSchema,
  passwordSchema,
  displayNameSchema,
  phoneSchema,
  uiLanguageSchema,
  usernameSchema,
} from './common';

/** Invite codes are matched case-insensitively (stored uppercase). */
export const inviteCodeInputSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(4, 'Enter your invite code')
  .max(64);

/** Minimum age required to register, per COPPA (ARCHITECTURE.md §11 Compliance). */
export const MIN_SIGNUP_AGE = 13;

/** True when the given date-of-birth is at least `MIN_SIGNUP_AGE` years ago. */
function isOldEnough(dateOfBirth: string): boolean {
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return false;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - MIN_SIGNUP_AGE);
  return dob.getTime() <= cutoff.getTime();
}

export const registerSchema = z.object({
  /** The platform is invite-only (SESSION "private access"): registration
   * requires a live code minted by an admin. */
  inviteCode: inviteCodeInputSchema,
  username: usernameSchema,
  email: emailSchema,
  /** Optional E.164 phone — becomes a second login identifier when provided. */
  phone: phoneSchema.optional(),
  password: passwordSchema,
  displayName: displayNameSchema,
  language: uiLanguageSchema.optional(),
  /** ISO date (YYYY-MM-DD). Used only for the COPPA age gate; not stored long-term. */
  dateOfBirth: z
    .string()
    .refine(isOldEnough, `You must be at least ${MIN_SIGNUP_AGE} years old to register`),
  /** Terms of service must be explicitly accepted (§15 governance). */
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the terms of service' }),
  }),
});

/**
 * Login accepts either the original `{ email }` shape (mobile app, admin login)
 * or `{ identifier }` — an email OR an E.164 phone number in one field (web
 * sign-in form). Exactly one of the two must be present; the service resolves
 * which kind of identifier it received.
 */
export const loginSchema = z
  .object({
    email: emailSchema.optional(),
    identifier: z.string().trim().min(3, 'Enter your email or phone').max(254).optional(),
    // Do not apply the full password policy on login — just require a non-empty value.
    // Policy is enforced at registration; login must still work for legacy passwords.
    password: z.string().min(1, 'Password is required'),
  })
  .refine((d) => (d.email !== undefined) !== (d.identifier !== undefined), {
    message: 'Provide your email or phone number',
    path: ['identifier'],
  });

/** POST /auth/google — the Google Identity Services ID token (JWT credential). */
export const googleAuthSchema = z.object({
  credential: z.string().min(20, 'Missing Google credential'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
