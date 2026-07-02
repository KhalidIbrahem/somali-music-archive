/**
 * Auth HTTP controllers (ARCHITECTURE.md §12 AUTH).
 *
 * Thin adapters: request bodies are already validated by `validate(...)` upstream,
 * so these just call the service and shape the response envelope. Business rules
 * live in auth.service, not here.
 */

import type { Request, Response } from 'express';
import type {
  ForgotPasswordInput,
  LoginInput,
  RefreshInput,
  RegisterInput,
} from '@sma/validators';
import { sendSuccess } from '@/shared/http/respond';
import { unauthorized } from '@/shared/errors/AppError';
import * as authService from './auth.service';
import { userRepository } from './user.repository';

export async function register(req: Request, res: Response): Promise<void> {
  const result = await authService.register(userRepository, req.body as RegisterInput);
  sendSuccess(res, result, 201);
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(userRepository, req.body as LoginInput);
  sendSuccess(res, result);
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body as RefreshInput;
  const tokens = await authService.refresh(userRepository, refreshToken);
  sendSuccess(res, tokens);
}

export async function logout(_req: Request, res: Response): Promise<void> {
  // Phase 1: add the presented access token to the Redis blacklist for its
  // remaining TTL and delete the refresh token row (ARCHITECTURE.md §8 step 6).
  sendSuccess(res, { success: true });
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  // Do not reveal whether the email exists (§11 — no account enumeration).
  void (req.body as ForgotPasswordInput);
  // Phase 1: enqueue a reset email via Resend if the account exists.
  sendSuccess(res, { success: true });
}

export async function me(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  const user = await authService.getCurrentUser(userRepository, req.user.id);
  sendSuccess(res, user);
}
