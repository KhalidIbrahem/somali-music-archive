import { describe, it, expect, beforeEach } from 'vitest';
import { AppError } from '@/shared/errors/AppError';
import { InMemorySubscriptionRepository } from './subscriptions.repository';
import { FakeStripeGateway, type StripeWebhookEvent } from './stripeGateway';
import { createSubscriptionsService, type SubscriptionsService } from './subscriptions.service';

let service: SubscriptionsService;
beforeEach(() => {
  service = createSubscriptionsService({
    repo: new InMemorySubscriptionRepository(),
    gateway: new FakeStripeGateway(),
  });
});

const checkoutCompleted: StripeWebhookEvent = {
  type: 'checkout.session.completed',
  userId: 'u1',
  subscription: {
    customerId: 'cus_1',
    subscriptionId: 'sub_1',
    status: 'active',
    priceId: undefined,
    currentPeriodStart: undefined,
    currentPeriodEnd: undefined,
    cancelAtPeriodEnd: false,
  },
};

const subscriptionUpdated: StripeWebhookEvent = {
  type: 'customer.subscription.updated',
  subscription: {
    customerId: 'cus_1',
    subscriptionId: 'sub_1',
    status: 'active',
    priceId: 'price_dummy', // premium (per vitest.setup)
    currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-02-01T00:00:00Z'),
    cancelAtPeriodEnd: false,
  },
};

describe('getPlans / getStatus', () => {
  it('lists the plan catalogue', () => {
    expect(service.getPlans().map((p) => p.plan)).toEqual(['free', 'premium', 'institutional']);
  });

  it('defaults a user with no record to free', async () => {
    const status = await service.getStatus('u1');
    expect(status.plan).toBe('free');
    expect(status.status).toBe('active');
  });
});

describe('createCheckout', () => {
  it('returns a checkout URL carrying the price and user reference', async () => {
    const { checkoutUrl } = await service.createCheckout('u1', { plan: 'premium' });
    expect(checkoutUrl).toContain('price_dummy');
    expect(checkoutUrl).toContain('client_reference_id=u1');
  });
});

describe('webhook sync', () => {
  it('links checkout then upgrades the plan on subscription.updated', async () => {
    await service.handleWebhook(checkoutCompleted);
    let status = await service.getStatus('u1');
    expect(status.stripeCustomerId).toBe('cus_1');
    expect(status.plan).toBe('free'); // price not known yet

    await service.handleWebhook(subscriptionUpdated);
    status = await service.getStatus('u1');
    expect(status.plan).toBe('premium');
    expect(status.status).toBe('active');
    expect(status.currentPeriodEnd).toBeDefined();
  });

  it('downgrades to free when the subscription is deleted', async () => {
    await service.handleWebhook(checkoutCompleted);
    await service.handleWebhook(subscriptionUpdated);
    await service.handleWebhook({ ...subscriptionUpdated, type: 'customer.subscription.deleted' });
    expect((await service.getStatus('u1')).plan).toBe('free');
  });

  it('ignores events for unknown customers', async () => {
    await service.handleWebhook(subscriptionUpdated); // no prior checkout link
    expect((await service.getStatus('u1')).plan).toBe('free');
  });
});

describe('cancel', () => {
  it('marks cancel-at-period-end once linked', async () => {
    await service.handleWebhook(checkoutCompleted);
    const result = await service.cancel('u1');
    expect(result.cancelAtPeriodEnd).toBe(true);
  });

  it('rejects cancelling with no paid subscription', async () => {
    await expect(service.cancel('nobody')).rejects.toBeInstanceOf(AppError);
  });
});
