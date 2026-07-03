import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryDeviceTokenRepository } from './deviceToken.repository';
import { FakeExpoPushGateway } from './expoPushGateway';
import { createNotificationsService, type NotificationsService } from './notifications.service';

let tokens: InMemoryDeviceTokenRepository;
let gateway: FakeExpoPushGateway;
let service: NotificationsService;

beforeEach(() => {
  tokens = new InMemoryDeviceTokenRepository();
  gateway = new FakeExpoPushGateway();
  service = createNotificationsService({ tokens, gateway });
});

describe('registerToken + sendToUser', () => {
  it('sends to every device registered to the user', async () => {
    await service.registerToken('u1', { token: 'ExponentPushToken[a]', platform: 'ios' });
    await service.registerToken('u1', { token: 'ExponentPushToken[b]', platform: 'android' });

    const count = await service.sendToUser('u1', { title: 'Hi', body: 'There' });

    expect(count).toBe(2);
    expect(gateway.sent).toHaveLength(2);
    expect(gateway.sent.map((m) => m.to).sort()).toEqual([
      'ExponentPushToken[a]',
      'ExponentPushToken[b]',
    ]);
    expect(gateway.sent[0]).toMatchObject({ title: 'Hi', body: 'There' });
  });

  it('is a no-op when the user has no registered devices', async () => {
    const count = await service.sendToUser('u1', { title: 'Hi', body: 'There' });
    expect(count).toBe(0);
    expect(gateway.sent).toHaveLength(0);
  });

  it('reassigns a token when the device signs in as a different user', async () => {
    await service.registerToken('u1', { token: 'ExponentPushToken[x]' });
    await service.registerToken('u2', { token: 'ExponentPushToken[x]' });

    expect(await service.sendToUser('u1', { title: 'a', body: 'b' })).toBe(0);
    expect(await service.sendToUser('u2', { title: 'a', body: 'b' })).toBe(1);
  });

  it('forwards custom data payloads', async () => {
    await service.registerToken('u1', { token: 'ExponentPushToken[a]' });
    await service.sendToUser('u1', {
      title: 'New recording',
      body: 'Balwo is live',
      data: { recordingId: 'rec-1' },
    });
    expect(gateway.sent[0]?.data).toEqual({ recordingId: 'rec-1' });
  });
});
