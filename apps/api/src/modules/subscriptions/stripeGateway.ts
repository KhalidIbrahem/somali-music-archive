/**
 * Stripe gateway (ARCHITECTURE.md §12 SUBSCRIPTIONS, ADR-0005).
 *
 * The subscriptions service depends on this INTERFACE, not on the Stripe SDK, so
 * checkout/cancel/webhook logic is unit-testable with a fake — no Stripe account
 * or network. Production uses `RealStripeGateway` (the SDK). Webhook events are
 * normalised to `StripeWebhookEvent` so the service never touches Stripe's types.
 */

import Stripe from 'stripe';
import type { SubscriptionStatus } from '@sma/types';
import { env, isProduction } from '@/config/env';

export interface CheckoutParams {
  userId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}

/** A subscription snapshot extracted from a Stripe event, in our own terms. */
export interface NormalizedSubscription {
  customerId: string;
  subscriptionId: string;
  status: SubscriptionStatus;
  priceId: string | undefined;
  currentPeriodStart: Date | undefined;
  currentPeriodEnd: Date | undefined;
  cancelAtPeriodEnd: boolean;
}

export interface StripeWebhookEvent {
  type: string;
  /** Our user id, from checkout.session.completed's client_reference_id. */
  userId?: string;
  /** Present for subscription.* events and completed checkouts. */
  subscription?: NormalizedSubscription;
}

export interface StripeGateway {
  createCheckoutSession(params: CheckoutParams): Promise<{ url: string }>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  constructWebhookEvent(rawBody: Buffer | string, signature: string): StripeWebhookEvent;
}

/** Map Stripe's subscription status to our narrower set. */
function mapStatus(status: string): SubscriptionStatus {
  if (status === 'active' || status === 'trialing') return 'active';
  if (status === 'canceled' || status === 'incomplete_expired') return 'canceled';
  return 'past_due';
}

function idOf(value: string | { id: string } | null | undefined): string {
  if (!value) return '';
  return typeof value === 'string' ? value : value.id;
}

// ── Fake (dev/test) ───────────────────────────────────────────────────────────

/** Returns deterministic fakes and treats the webhook body as an already-normalised
 * event JSON (so dev/tests can POST events without signing them). */
export class FakeStripeGateway implements StripeGateway {
  async createCheckoutSession(params: CheckoutParams): Promise<{ url: string }> {
    const url = new URL('https://checkout.stripe.test/session');
    url.searchParams.set('price', params.priceId);
    url.searchParams.set('client_reference_id', params.userId);
    return { url: url.toString() };
  }

  async cancelSubscription(_subscriptionId: string): Promise<void> {
    // no-op in the fake
  }

  constructWebhookEvent(rawBody: Buffer | string, _signature: string): StripeWebhookEvent {
    return JSON.parse(rawBody.toString()) as StripeWebhookEvent;
  }
}

// ── Real (production) ─────────────────────────────────────────────────────────

export class RealStripeGateway implements StripeGateway {
  private readonly stripe = new Stripe(env.STRIPE_SECRET_KEY);

  async createCheckoutSession(params: CheckoutParams): Promise<{ url: string }> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: params.priceId, quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      client_reference_id: params.userId,
      ...(params.customerEmail ? { customer_email: params.customerEmail } : {}),
    });
    return { url: session.url ?? '' };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
  }

  constructWebhookEvent(rawBody: Buffer | string, signature: string): StripeWebhookEvent {
    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
    return this.normalize(event);
  }

  private normalize(event: Stripe.Event): StripeWebhookEvent {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as Stripe.Checkout.Session;
      return {
        type: event.type,
        ...(s.client_reference_id ? { userId: s.client_reference_id } : {}),
        subscription: {
          customerId: idOf(s.customer),
          subscriptionId: idOf(s.subscription),
          status: 'active',
          priceId: undefined,
          currentPeriodStart: undefined,
          currentPeriodEnd: undefined,
          cancelAtPeriodEnd: false,
        },
      };
    }
    if (event.type.startsWith('customer.subscription.')) {
      const sub = event.data.object as Stripe.Subscription;
      return {
        type: event.type,
        subscription: {
          customerId: idOf(sub.customer),
          subscriptionId: sub.id,
          status: event.type.endsWith('deleted') ? 'canceled' : mapStatus(sub.status),
          priceId: sub.items.data[0]?.price.id,
          currentPeriodStart: new Date(sub.current_period_start * 1000),
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        },
      };
    }
    return { type: event.type };
  }
}

export const stripeGateway: StripeGateway = isProduction
  ? new RealStripeGateway()
  : new FakeStripeGateway();
