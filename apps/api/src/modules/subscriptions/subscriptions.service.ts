/**
 * Subscriptions service (ARCHITECTURE.md §12 SUBSCRIPTIONS).
 *
 * Checkout, status, cancel, and webhook sync — built on injected repo + Stripe
 * gateway (ADR-0005), so all branches are unit-testable with the fake gateway.
 */

import type { PlanOption, Subscription } from '@sma/types';
import type { CheckoutInput } from '@sma/validators';
import { badRequest } from '@/shared/errors/AppError';
import { env } from '@/config/env';
import { organizationsService } from '@/modules/organizations/organizations.service';
import { PLAN_OPTIONS, priceIdForPlan, planForPriceId } from './plans';
import { subscriptionRepository, type SubscriptionRepository } from './subscriptions.repository';
import { stripeGateway, type StripeGateway, type StripeWebhookEvent } from './stripeGateway';

export function createSubscriptionsService(deps: {
  repo: SubscriptionRepository;
  gateway: StripeGateway;
  /** Whether the user holds an active institutional seat (SESSION P4-02). Injected
   * so subscriptions need not depend on the organisations module's internals. */
  hasInstitutionalSeat?: (userId: string) => Promise<boolean>;
}) {
  const { repo, gateway } = deps;
  const hasInstitutionalSeat = deps.hasInstitutionalSeat ?? (async () => false);

  function getPlans(): readonly PlanOption[] {
    return PLAN_OPTIONS;
  }

  /**
   * The user's effective subscription. An active institutional seat (P4-02) grants
   * institutional-tier entitlement without a personal payment, so it overrides a
   * free/premium personal plan for entitlement purposes.
   */
  async function getStatus(userId: string): Promise<Subscription> {
    const subscription = await repo.getForUser(userId);
    if (subscription.plan === 'institutional') return subscription;
    if (await hasInstitutionalSeat(userId)) {
      return { ...subscription, plan: 'institutional' };
    }
    return subscription;
  }

  async function createCheckout(
    userId: string,
    input: CheckoutInput,
    customerEmail?: string,
  ): Promise<{ checkoutUrl: string }> {
    const { url } = await gateway.createCheckoutSession({
      userId,
      priceId: priceIdForPlan(input.plan),
      successUrl: `${env.API_URL}/subscription/success`,
      cancelUrl: `${env.API_URL}/subscription/cancel`,
      ...(customerEmail ? { customerEmail } : {}),
    });
    return { checkoutUrl: url };
  }

  async function cancel(userId: string): Promise<Subscription> {
    const current = await repo.getForUser(userId);
    if (!current.stripeSubscriptionId) {
      throw badRequest('SUBSCRIPTION_REQUIRED', 'No active paid subscription to cancel');
    }
    await gateway.cancelSubscription(current.stripeSubscriptionId);
    return repo.upsert(userId, { cancelAtPeriodEnd: true });
  }

  /** Apply a (already signature-verified) Stripe event to the local mirror. */
  async function handleWebhook(event: StripeWebhookEvent): Promise<void> {
    const sub = event.subscription;
    if (!sub) return;

    if (event.type === 'checkout.session.completed' && event.userId) {
      // Link the Stripe customer/subscription to our user; details follow via
      // the customer.subscription.updated event.
      await repo.upsert(event.userId, {
        stripeCustomerId: sub.customerId,
        stripeSubscriptionId: sub.subscriptionId,
        status: 'active',
      });
      return;
    }

    if (event.type.startsWith('customer.subscription.')) {
      const userId = await repo.findUserIdByCustomerId(sub.customerId);
      if (!userId) return; // unknown customer — nothing to mirror
      await repo.upsert(userId, {
        stripeSubscriptionId: sub.subscriptionId,
        status: sub.status,
        plan: event.type.endsWith('deleted') ? 'free' : planForPriceId(sub.priceId),
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        ...(sub.currentPeriodStart ? { currentPeriodStart: sub.currentPeriodStart } : {}),
        ...(sub.currentPeriodEnd ? { currentPeriodEnd: sub.currentPeriodEnd } : {}),
      });
    }
  }

  /** Verify + apply a raw Stripe webhook request. Returns the event type. */
  async function processWebhook(rawBody: Buffer | string, signature: string): Promise<string> {
    const event = gateway.constructWebhookEvent(rawBody, signature);
    await handleWebhook(event);
    return event.type;
  }

  return { getPlans, getStatus, createCheckout, cancel, handleWebhook, processWebhook };
}

export type SubscriptionsService = ReturnType<typeof createSubscriptionsService>;

export const subscriptionsService: SubscriptionsService = createSubscriptionsService({
  repo: subscriptionRepository,
  gateway: stripeGateway,
  hasInstitutionalSeat: (userId) => organizationsService.hasActiveSeat(userId),
});
