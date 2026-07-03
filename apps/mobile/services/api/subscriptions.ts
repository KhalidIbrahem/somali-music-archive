/**
 * Subscription API calls (ARCHITECTURE.md §12 SUBSCRIPTIONS).
 */

import type { ApiResponse, PlanOption, Subscription } from '@sma/types';
import type { CheckoutInput } from '@sma/validators';
import { apiClient } from './client';
import { unwrap } from './unwrap';

export async function getPlans(): Promise<PlanOption[]> {
  const res = await apiClient.get<ApiResponse<PlanOption[]>>('/subscriptions/plans');
  return unwrap(res.data);
}

export async function getSubscriptionStatus(): Promise<Subscription> {
  const res = await apiClient.get<ApiResponse<Subscription>>('/subscriptions/status');
  return unwrap(res.data);
}

export async function createCheckout(input: CheckoutInput): Promise<{ checkoutUrl: string }> {
  const res = await apiClient.post<ApiResponse<{ checkoutUrl: string }>>(
    '/subscriptions/checkout',
    input,
  );
  return unwrap(res.data);
}

export async function cancelSubscription(): Promise<Subscription> {
  const res = await apiClient.post<ApiResponse<Subscription>>('/subscriptions/cancel');
  return unwrap(res.data);
}
