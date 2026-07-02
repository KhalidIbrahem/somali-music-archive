/**
 * Subscription & billing types — a local mirror of Stripe state (ARCHITECTURE.md §9).
 *
 * We never treat Stripe as the live source of truth on the request path; a webhook
 * syncs Stripe → this row, and the app reads the row. That keeps entitlement checks
 * fast and resilient to Stripe latency/outages.
 */

import type { Uuid, IsoDateTimeString } from './common';

/** Product tiers. `free` is the default for every new account. */
export type SubscriptionPlan = 'free' | 'premium' | 'institutional';

/** Lifecycle mirrored from Stripe. */
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled';

export interface Subscription {
  readonly id: Uuid;
  readonly userId: Uuid;
  readonly stripeCustomerId?: string;
  readonly stripeSubscriptionId?: string;
  readonly plan: SubscriptionPlan;
  readonly status: SubscriptionStatus;
  readonly currentPeriodStart?: IsoDateTimeString;
  readonly currentPeriodEnd?: IsoDateTimeString;
  readonly cancelAtPeriodEnd: boolean;
  readonly createdAt: IsoDateTimeString;
  readonly updatedAt: IsoDateTimeString;
}

/** A purchasable plan as presented on the subscription screen. */
export interface PlanOption {
  readonly plan: SubscriptionPlan;
  readonly label: string;
  /** Price in the smallest currency unit (cents), or null for custom/enterprise. */
  readonly amountCents: number | null;
  readonly currency: string;
  readonly interval: 'month' | 'year';
  readonly features: readonly string[];
}
