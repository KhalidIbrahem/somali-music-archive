/**
 * Organisation controllers (SESSION P4-02, ARCHITECTURE.md §16 Phase 4).
 *
 * Creating a license is admin-only (route middleware); owner-only actions
 * (list/remove members) are enforced in the service by comparing the org's owner
 * to the caller. Everything requires a signed-in user.
 */

import type { Request, Response } from 'express';
import type { CreateOrganizationInput, JoinOrganizationInput } from '@sma/validators';
import { sendSuccess } from '@/shared/http/respond';
import { unauthorized } from '@/shared/errors/AppError';
import { organizationsService } from './organizations.service';

export async function create(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  const org = await organizationsService.createOrganization(
    req.user.id,
    req.body as CreateOrganizationInput,
  );
  sendSuccess(res, org, 201);
}

export async function mine(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  sendSuccess(res, await organizationsService.getMyMembership(req.user.id));
}

export async function join(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  const { licenseKey } = req.body as JoinOrganizationInput;
  sendSuccess(res, await organizationsService.joinOrganization(req.user.id, licenseKey));
}

export async function leave(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  await organizationsService.leaveOrganization(req.user.id);
  sendSuccess(res, { left: true });
}

export async function getById(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  sendSuccess(res, await organizationsService.getOrganization(req.params['id'] ?? '', req.user.id));
}

export async function listMembers(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  sendSuccess(res, await organizationsService.listMembers(req.user.id, req.params['id'] ?? ''));
}

export async function removeMember(req: Request, res: Response): Promise<void> {
  if (!req.user) throw unauthorized();
  await organizationsService.removeMember(
    req.user.id,
    req.params['id'] ?? '',
    req.params['userId'] ?? '',
  );
  sendSuccess(res, { removed: true });
}
