/**
 * Push-notification input schemas (ARCHITECTURE.md §5, §8 notifications).
 */

import { z } from 'zod';

/** Register (or refresh) a device's Expo push token for the current user. */
export const registerPushTokenSchema = z.object({
  token: z.string().min(1).max(400),
  platform: z.enum(['ios', 'android', 'web']).optional(),
});

export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema>;
