/**
 * User profile input schemas (ARCHITECTURE.md §12 USERS).
 */

import { z } from 'zod';
import { displayNameSchema, uiLanguageSchema } from './common';

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
