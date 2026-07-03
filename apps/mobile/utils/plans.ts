/**
 * Pure display helper for subscription plan pricing. Unit-tested.
 */

import type { PlanOption } from '@sma/types';

/** Human price label, e.g. "Free", "$9/mo", "$500/yr", "Custom". */
export function formatPlanPrice(plan: PlanOption): string {
  if (plan.amountCents === null) return 'Custom';
  if (plan.amountCents === 0) return 'Free';
  const dollars = plan.amountCents / 100;
  const amount = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
  return `$${amount}/${plan.interval === 'year' ? 'yr' : 'mo'}`;
}
