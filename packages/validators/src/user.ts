/**
 * User profile input schemas (ARCHITECTURE.md §12 USERS).
 */

import { z } from 'zod';
import { USER_ROLES } from '@sma/types';
import { displayNameSchema, paginationQuerySchema, uiLanguageSchema } from './common';

/** PATCH /users/me — update a subset of the caller's own profile. */
export const updateProfileSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    language: uiLanguageSchema.optional(),
    avatarUrl: z.string().url().max(2048).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** PATCH /users/:id/role — an admin granting a member a role (e.g. educator). */
export const changeRoleSchema = z.object({
  role: z.enum(USER_ROLES),
});

export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

/** GET /users (admin) — paginated member list with an optional search term. */
export const listUsersQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
});

export type ListUsersQuery = z.output<typeof listUsersQuerySchema>;
