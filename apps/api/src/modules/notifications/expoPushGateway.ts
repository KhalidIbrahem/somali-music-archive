/**
 * Expo Push gateway (ARCHITECTURE.md §5, §8, ADR-0005).
 *
 * Sends notifications through Expo's push service (which fans out to FCM/APNs). The
 * notifications service depends on this INTERFACE, so it is unit-testable with a
 * fake that records messages — no network. Production POSTs to the Expo push API.
 */

import { logger } from '@/shared/logger';
import { isProduction } from '@/config/env';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface ExpoPushGateway {
  send(messages: readonly ExpoPushMessage[]): Promise<void>;
}

/** Records messages in memory (inspectable in tests); never hits the network. */
export class FakeExpoPushGateway implements ExpoPushGateway {
  readonly sent: ExpoPushMessage[] = [];

  async send(messages: readonly ExpoPushMessage[]): Promise<void> {
    this.sent.push(...messages);
    logger.info({ count: messages.length }, '[push] would send (fake)');
  }
}

/** Production: POST the batch to Expo's push API. */
export class RealExpoPushGateway implements ExpoPushGateway {
  async send(messages: readonly ExpoPushMessage[]): Promise<void> {
    if (messages.length === 0) return;
    const res = await fetch(EXPO_PUSH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      logger.error({ status: res.status }, '[push] Expo push send failed');
    }
  }
}

export const expoPushGateway: ExpoPushGateway = isProduction
  ? new RealExpoPushGateway()
  : new FakeExpoPushGateway();
