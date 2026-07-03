/**
 * Notifications service (ARCHITECTURE.md §8 — notification:send).
 *
 * Registers device tokens and fans a message out to all of a user's devices via the
 * Expo push gateway. Injected deps (ADR-0005) so it is unit-testable with a fake.
 */

import type { RegisterPushTokenInput } from '@sma/validators';
import { deviceTokenRepository, type DeviceTokenRepository } from './deviceToken.repository';
import { expoPushGateway, type ExpoPushGateway } from './expoPushGateway';

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export function createNotificationsService(deps: {
  tokens: DeviceTokenRepository;
  gateway: ExpoPushGateway;
}) {
  const { tokens, gateway } = deps;

  async function registerToken(userId: string, input: RegisterPushTokenInput): Promise<void> {
    await tokens.register(userId, input.token, input.platform);
  }

  /** Send a message to every device registered to a user (no-op if none). */
  async function sendToUser(userId: string, message: PushMessage): Promise<number> {
    const userTokens = await tokens.listTokens(userId);
    if (userTokens.length === 0) return 0;
    await gateway.send(
      userTokens.map((to) => ({
        to,
        title: message.title,
        body: message.body,
        ...(message.data ? { data: message.data } : {}),
      })),
    );
    return userTokens.length;
  }

  return { registerToken, sendToUser };
}

export type NotificationsService = ReturnType<typeof createNotificationsService>;

export const notificationsService: NotificationsService = createNotificationsService({
  tokens: deviceTokenRepository,
  gateway: expoPushGateway,
});
