/**
 * Subscription plans (ARCHITECTURE.md §2 pricing, §12 GET /subscriptions/plans).
 * Static catalogue presented on the paywall; the Stripe price ids for the paid
 * tiers come from env (STRIPE_*_PRICE_ID).
 */

import type { PlanOption, SubscriptionPlan } from '@sma/types';
import { env } from '@/config/env';

export const PLAN_OPTIONS: readonly PlanOption[] = [
  {
    plan: 'free',
    label: 'Free',
    amountCents: 0,
    currency: 'usd',
    interval: 'month',
    features: ['Browse the public archive', 'The first lessons', 'Save recordings'],
  },
  {
    plan: 'premium',
    label: 'Premium',
    amountCents: 900,
    currency: 'usd',
    interval: 'month',
    features: [
      'Full archive access',
      'All lessons + pitch exercises',
      'Offline downloads',
      'High-quality audio',
    ],
  },
  {
    plan: 'institutional',
    label: 'Institutional',
    amountCents: 50000,
    currency: 'usd',
    interval: 'year',
    features: [
      'Everything in Premium',
      'Multiple seats',
      'Admin controls',
      'Curriculum for schools',
    ],
  },
];

/** Resolve a paid plan to its configured Stripe price id. */
export function priceIdForPlan(plan: Exclude<SubscriptionPlan, 'free'>): string {
  return plan === 'premium' ? env.STRIPE_PREMIUM_PRICE_ID : env.STRIPE_INSTITUTIONAL_PRICE_ID;
}

/** Reverse-map a Stripe price id back to our plan (for webhook sync). */
export function planForPriceId(priceId: string | undefined): SubscriptionPlan {
  if (priceId === env.STRIPE_PREMIUM_PRICE_ID) return 'premium';
  if (priceId === env.STRIPE_INSTITUTIONAL_PRICE_ID) return 'institutional';
  return 'free';
}
