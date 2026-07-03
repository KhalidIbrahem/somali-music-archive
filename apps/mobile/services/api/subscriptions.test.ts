import { getPlans, createCheckout, cancelSubscription } from './subscriptions';
import { apiClient } from './client';

jest.mock('./client', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));

beforeEach(() => jest.clearAllMocks());

describe('subscriptions API', () => {
  it('GETs plans', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({ data: { success: true, data: [] } });
    await getPlans();
    expect(apiClient.get).toHaveBeenCalledWith('/subscriptions/plans');
  });

  it('POSTs checkout with the chosen plan and unwraps the url', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({
      data: { success: true, data: { checkoutUrl: 'https://checkout.test' } },
    });
    const result = await createCheckout({ plan: 'premium' });
    expect(apiClient.post).toHaveBeenCalledWith('/subscriptions/checkout', { plan: 'premium' });
    expect(result.checkoutUrl).toBe('https://checkout.test');
  });

  it('POSTs cancel', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({
      data: { success: true, data: { plan: 'premium', cancelAtPeriodEnd: true } },
    });
    const sub = await cancelSubscription();
    expect(apiClient.post).toHaveBeenCalledWith('/subscriptions/cancel');
    expect(sub.cancelAtPeriodEnd).toBe(true);
  });
});
