/**
 * PostgreSQL subscription persistence (SESSION "db-backed repositories",
 * ARCHITECTURE.md §9 subscriptions).
 *
 * Prisma-backed mirror of Stripe state over the `subscriptions` table. Binds in
 * place of the in-memory version when PERSISTENCE=database. Users with no row are
 * treated as `free` (never persisted). `upsert` is a find-then-update/create
 * rather than prisma.upsert because `user_id` is indexed, not unique — one logical
 * subscription per user is enforced by the service, not a DB constraint.
 */

import { type PrismaClient, type Subscription as SubscriptionRow } from '@prisma/client';
import type { Subscription } from '@sma/types';
import { asIso, asUuid } from '@/shared/brand';
import {
  freeSubscription,
  type SubscriptionPatch,
  type SubscriptionRepository,
} from './subscriptions.repository';

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: asUuid(row.id),
    userId: asUuid(row.userId),
    plan: row.plan,
    status: row.status,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    createdAt: asIso(row.createdAt),
    updatedAt: asIso(row.updatedAt),
    ...(row.stripeCustomerId ? { stripeCustomerId: row.stripeCustomerId } : {}),
    ...(row.stripeSubscriptionId ? { stripeSubscriptionId: row.stripeSubscriptionId } : {}),
    ...(row.currentPeriodStart ? { currentPeriodStart: asIso(row.currentPeriodStart) } : {}),
    ...(row.currentPeriodEnd ? { currentPeriodEnd: asIso(row.currentPeriodEnd) } : {}),
  };
}

/** Drop undefined keys so a patch never overwrites a column with `undefined`. */
function toData(patch: SubscriptionPatch) {
  return {
    ...(patch.stripeCustomerId !== undefined ? { stripeCustomerId: patch.stripeCustomerId } : {}),
    ...(patch.stripeSubscriptionId !== undefined
      ? { stripeSubscriptionId: patch.stripeSubscriptionId }
      : {}),
    ...(patch.plan !== undefined ? { plan: patch.plan } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.currentPeriodStart !== undefined
      ? { currentPeriodStart: patch.currentPeriodStart }
      : {}),
    ...(patch.currentPeriodEnd !== undefined ? { currentPeriodEnd: patch.currentPeriodEnd } : {}),
    ...(patch.cancelAtPeriodEnd !== undefined
      ? { cancelAtPeriodEnd: patch.cancelAtPeriodEnd }
      : {}),
  };
}

export class PrismaSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getForUser(userId: string): Promise<Subscription> {
    const row = await this.prisma.subscription.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toSubscription(row) : freeSubscription(userId);
  }

  async findUserIdByCustomerId(customerId: string): Promise<string | null> {
    const row = await this.prisma.subscription.findUnique({
      where: { stripeCustomerId: customerId },
      select: { userId: true },
    });
    return row?.userId ?? null;
  }

  async upsert(userId: string, patch: SubscriptionPatch): Promise<Subscription> {
    const existing = await this.prisma.subscription.findFirst({ where: { userId } });
    if (existing) {
      const row = await this.prisma.subscription.update({
        where: { id: existing.id },
        data: toData(patch),
      });
      return toSubscription(row);
    }
    const row = await this.prisma.subscription.create({ data: { userId, ...toData(patch) } });
    return toSubscription(row);
  }
}
