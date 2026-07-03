import { registerPushToken, sendTestNotification } from './notifications';
import { apiClient } from './client';

jest.mock('./client', () => ({ apiClient: { post: jest.fn() } }));

beforeEach(() => jest.clearAllMocks());

describe('notifications API', () => {
  it('POSTs the push token registration', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({
      data: { success: true, data: { registered: true } },
    });
    await registerPushToken({ token: 'ExponentPushToken[a]', platform: 'ios' });
    expect(apiClient.post).toHaveBeenCalledWith('/notifications/register-token', {
      token: 'ExponentPushToken[a]',
      platform: 'ios',
    });
  });

  it('requests a test push and unwraps the count', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({ data: { success: true, data: { sent: 2 } } });
    expect(await sendTestNotification()).toBe(2);
  });
});
