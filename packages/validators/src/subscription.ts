/**
 * Subscription input schemas (ARCHITECTURE.md §12 SUBSCRIPTIONS).
 */

import { z } from 'zod';

/** Only paid plans can be checked out; `free` is the default, not a purchase. */
export const checkoutSchema = z.object({
  plan: z.enum(['premium', 'institutional']),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
