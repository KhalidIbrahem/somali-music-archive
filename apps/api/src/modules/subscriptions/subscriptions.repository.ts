/**
 * Subscription persistence (ARCHITECTURE.md §9 subscriptions).
 *
 * A local mirror of Stripe state so entitlement checks never depend on Stripe being
 * reachable on the request path. Interface-first (ADR-0005): Prisma-backed in
 * production. Users with no record are treated as `free`.
 */

import type { Subscription, SubscriptionPlan, SubscriptionStatus } from '@sma/types';
import { asIso, asUuid } from '@/shared/brand';
import { randomUUID } from '@/shared/crypto';
import { useDatabase } from '@/shared/db/driver';
import { getPrisma } from '@/shared/db/prisma';
import { PrismaSubscriptionRepository } from './subscriptions.prisma.repository';

interface SubscriptionRecord {
  id: string;
  userId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionPatch {
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  plan?: SubscriptionPlan;
  status?: SubscriptionStatus;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
}

export interface SubscriptionRepository {
  /** The user's subscription, or a synthesized `free` one if they have no record. */
  getForUser(userId: string): Promise<Subscription>;
  findUserIdByCustomerId(customerId: string): Promise<string | null>;
  upsert(userId: string, patch: SubscriptionPatch): Promise<Subscription>;
}

function toSubscription(rec: SubscriptionRecord): Subscription {
  return {
    id: asUuid(rec.id),
    userId: asUuid(rec.userId),
    plan: rec.plan,
    status: rec.status,
    cancelAtPeriodEnd: rec.cancelAtPeriodEnd,
    createdAt: asIso(rec.createdAt),
    updatedAt: asIso(rec.updatedAt),
    ...(rec.stripeCustomerId ? { stripeCustomerId: rec.stripeCustomerId } : {}),
    ...(rec.stripeSubscriptionId ? { stripeSubscriptionId: rec.stripeSubscriptionId } : {}),
    ...(rec.currentPeriodStart ? { currentPeriodStart: asIso(rec.currentPeriodStart) } : {}),
    ...(rec.currentPeriodEnd ? { currentPeriodEnd: asIso(rec.currentPeriodEnd) } : {}),
  };
}

/** A default free subscription for users who have never paid (not persisted). */
export function freeSubscription(userId: string): Subscription {
  const now = new Date();
  return {
    id: asUuid(randomUUID()),
    userId: asUuid(userId),
    plan: 'free',
    status: 'active',
    cancelAtPeriodEnd: false,
    createdAt: asIso(now),
    updatedAt: asIso(now),
  };
}

export class InMemorySubscriptionRepository implements SubscriptionRepository {
  private readonly byUser = new Map<string, SubscriptionRecord>();

  async getForUser(userId: string): Promise<Subscription> {
    const rec = this.byUser.get(userId);
    return rec ? toSubscription(rec) : freeSubscription(userId);
  }

  async findUserIdByCustomerId(customerId: string): Promise<string | null> {
    for (const rec of this.byUser.values()) {
      if (rec.stripeCustomerId === customerId) return rec.userId;
    }
    return null;
  }

  async upsert(userId: string, patch: SubscriptionPatch): Promise<Subscription> {
    const now = new Date();
    let rec = this.byUser.get(userId);
    if (!rec) {
      rec = {
        id: randomUUID(),
        userId,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        plan: 'free',
        status: 'active',
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        createdAt: now,
        updatedAt: now,
      };
      this.byUser.set(userId, rec);
    }
    if (patch.stripeCustomerId !== undefined) rec.stripeCustomerId = patch.stripeCustomerId;
    if (patch.stripeSubscriptionId !== undefined)
      rec.stripeSubscriptionId = patch.stripeSubscriptionId;
    if (patch.plan !== undefined) rec.plan = patch.plan;
    if (patch.status !== undefined) rec.status = patch.status;
    if (patch.currentPeriodStart !== undefined) rec.currentPeriodStart = patch.currentPeriodStart;
    if (patch.currentPeriodEnd !== undefined) rec.currentPeriodEnd = patch.currentPeriodEnd;
    if (patch.cancelAtPeriodEnd !== undefined) rec.cancelAtPeriodEnd = patch.cancelAtPeriodEnd;
    rec.updatedAt = now;
    return toSubscription(rec);
  }
}

export const subscriptionRepository: SubscriptionRepository = useDatabase()
  ? new PrismaSubscriptionRepository(getPrisma())
  : new InMemorySubscriptionRepository();
