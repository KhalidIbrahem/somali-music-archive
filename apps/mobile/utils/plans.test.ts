import { formatPlanPrice } from './plans';
import type { PlanOption } from '@sma/types';

const plan = (amountCents: number | null, interval: 'month' | 'year'): PlanOption =>
  ({
    plan: 'premium',
    label: 'Premium',
    amountCents,
    currency: 'usd',
    interval,
    features: [],
  }) as PlanOption;

describe('formatPlanPrice', () => {
  it('labels free and custom plans', () => {
    expect(formatPlanPrice(plan(0, 'month'))).toBe('Free');
    expect(formatPlanPrice(plan(null, 'year'))).toBe('Custom');
  });

  it('formats monthly and yearly prices', () => {
    expect(formatPlanPrice(plan(900, 'month'))).toBe('$9/mo');
    expect(formatPlanPrice(plan(50000, 'year'))).toBe('$500/yr');
  });

  it('shows cents when not a whole dollar', () => {
    expect(formatPlanPrice(plan(1499, 'month'))).toBe('$14.99/mo');
  });
});
