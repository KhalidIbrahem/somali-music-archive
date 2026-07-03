/**
 * Transactional email (ARCHITECTURE.md §5 — Resend).
 *
 * Only the auth flows need email so far: verification and password reset. The
 * interface hides the provider; production uses Resend (via `fetch`, no SDK
 * dependency), while development/test uses a logging implementation that never
 * makes a network call and never prints the raw token at info level.
 *
 * Tests inject a spy through `createAuthService`, so this module's selection logic
 * is not exercised in unit tests.
 */

import { env, isProduction } from '@/config/env';
import { logger } from '@/shared/logger';

export interface EmailService {
  sendVerificationEmail(to: string, token: string): Promise<void>;
  sendPasswordResetEmail(to: string, token: string): Promise<void>;
}

/** Dev/test implementation: logs that an email would be sent. The raw token is
 * only emitted at debug level so it never lands in production-style info logs. */
class LoggingEmailService implements EmailService {
  async sendVerificationEmail(to: string, token: string): Promise<void> {
    logger.info({ to }, '[email] would send verification email');
    logger.debug({ to, token }, '[email] verification token (dev only)');
  }

  async sendPasswordResetEmail(to: string, token: string): Promise<void> {
    logger.info({ to }, '[email] would send password reset email');
    logger.debug({ to, token }, '[email] password reset token (dev only)');
  }
}

/** Production implementation: Resend HTTP API. */
class ResendEmailService implements EmailService {
  private async send(to: string, subject: string, html: string): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, html }),
    });
    if (!res.ok) {
      logger.error({ to, status: res.status }, '[email] Resend send failed');
    }
  }

  async sendVerificationEmail(to: string, token: string): Promise<void> {
    const link = `${env.API_URL}/verify-email?token=${token}`;
    await this.send(
      to,
      'Verify your email — Somali Music Archive',
      `<p>Welcome. Please verify your email:</p><p><a href="${link}">Verify email</a></p>`,
    );
  }

  async sendPasswordResetEmail(to: string, token: string): Promise<void> {
    const link = `${env.API_URL}/reset-password?token=${token}`;
    await this.send(
      to,
      'Reset your password — Somali Music Archive',
      `<p>Reset your password:</p><p><a href="${link}">Reset password</a></p>`,
    );
  }
}

export const emailService: EmailService = isProduction
  ? new ResendEmailService()
  : new LoggingEmailService();
