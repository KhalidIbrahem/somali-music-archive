/**
 * Device push-token persistence (ARCHITECTURE.md §8 notifications).
 *
 * Maps each device's Expo push token to a user. Keyed by token so a device that
 * signs in as a different user simply reassigns its token (a token belongs to one
 * device, one user at a time). Interface-first (ADR-0005): Prisma-backed later.
 */

export type DevicePlatform = 'ios' | 'android' | 'web';

interface DeviceTokenRecord {
  token: string;
  userId: string;
  platform: DevicePlatform | undefined;
  createdAt: Date;
}

export interface DeviceTokenRepository {
  register(userId: string, token: string, platform?: DevicePlatform): Promise<void>;
  listTokens(userId: string): Promise<string[]>;
  remove(token: string): Promise<void>;
}

export class InMemoryDeviceTokenRepository implements DeviceTokenRepository {
  private readonly byToken = new Map<string, DeviceTokenRecord>();

  async register(userId: string, token: string, platform?: DevicePlatform): Promise<void> {
    this.byToken.set(token, {
      token,
      userId,
      platform,
      createdAt: this.byToken.get(token)?.createdAt ?? new Date(),
    });
  }

  async listTokens(userId: string): Promise<string[]> {
    const tokens: string[] = [];
    for (const record of this.byToken.values()) {
      if (record.userId === userId) tokens.push(record.token);
    }
    return tokens;
  }

  async remove(token: string): Promise<void> {
    this.byToken.delete(token);
  }
}

export const deviceTokenRepository: DeviceTokenRepository = new InMemoryDeviceTokenRepository();
