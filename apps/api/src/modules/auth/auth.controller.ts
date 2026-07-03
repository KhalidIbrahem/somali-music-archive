/**
 * Auth HTTP controllers (ARCHITECTURE.md §12 AUTH).
 *
 * Thin adapters: request bodies are already validated by `validate(...)` upstream,
 * so these call the composed `authService` and shape the response envelope.
 */

import type { Request, Response } from 'express';
import type {
  ForgotPasswordInput,
  LoginInput,
  RefreshInput,
  RegisterInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from '@sma/validators';
import { sendSuccess } from '@/shared/http/respond';
import { unauthorized } from '@/shared/errors/AppError';
import { authService } from './auth.service';

export async function register(req: Request, res: Response): Promise<void> {
  const result = await authService.register(req.body as RegisterInput);
  sendSuccess(res, result, 201);
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body as LoginInput);
  sendSuccess(res, result);
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body as RefreshInput;
  const tokens = await authService.refresh(refreshToken);
  sendSuccess(res, tokens);
}

export async function logout(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  await authService.logout({ userId: req.user.id, jti: req.user.jti, exp: req.user.exp });
  sendSuccess(res, { success: true });
}

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  await authService.verifyEmail(req.body as VerifyEmailInput);
  sendSuccess(res, { success: true });
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  // Always responds success whether or not the email exists (no enumeration, §11).
  await authService.forgotPassword(req.body as ForgotPasswordInput);
  sendSuccess(res, { success: true });
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  await authService.resetPassword(req.body as ResetPasswordInput);
  sendSuccess(res, { success: true });
}
