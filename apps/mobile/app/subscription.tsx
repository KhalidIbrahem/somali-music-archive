/**
 * Subscription / paywall (SESSION P2-05, ARCHITECTURE.md §7, §12 SUBSCRIPTIONS).
 *
 * Shows the plan catalogue and the learner's current status. Subscribing opens the
 * Stripe Checkout URL in the browser; the resulting webhook syncs status server-side,
 * so pulling back to this screen reflects the new plan. Paid plans can be cancelled.
 */

import { ActivityIndicator, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import type { PlanOption, SubscriptionPlan } from '@sma/types';
import { Screen, Text, Card, Button } from '@/components/ui';
import {
  getPlans,
  getSubscriptionStatus,
  createCheckout,
  cancelSubscription,
} from '@/services/api/subscriptions';
import { formatPlanPrice } from '@/utils/plans';
import { colors, radius, spacing } from '@/theme';

export default function Subscription(): React.JSX.Element {
  const queryClient = useQueryClient();
  const plansQuery = useQuery({ queryKey: ['subscription-plans'], queryFn: getPlans });
  const statusQuery = useQuery({
    queryKey: ['subscription-status'],
    queryFn: getSubscriptionStatus,
  });

  const checkout = useMutation({
    mutationFn: (plan: Exclude<SubscriptionPlan, 'free'>) => createCheckout({ plan }),
    onSuccess: ({ checkoutUrl }) => {
      void Linking.openURL(checkoutUrl);
    },
  });

  const cancel = useMutation({
    mutationFn: cancelSubscription,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subscription-status'] }),
  });

  const currentPlan = statusQuery.data?.plan ?? 'free';
  const cancelAtPeriodEnd = statusQuery.data?.cancelAtPeriodEnd ?? false;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text variant="displayLarge">Membership</Text>
        <Text variant="bodyMedium" color="secondary">
          Support the archive and unlock the full experience.
        </Text>

        {plansQuery.isLoading ? (
          <ActivityIndicator color={colors.amber.primary} style={styles.loader} />
        ) : (
          (plansQuery.data ?? []).map((plan) => {
            // Capture the narrowed paid plan in a const so it stays narrowed inside
            // the onSubscribe closure.
            const paidPlan: Exclude<SubscriptionPlan, 'free'> | null =
              plan.plan === 'free' ? null : plan.plan;
            return (
              <PlanCard
                key={plan.plan}
                plan={plan}
                isCurrent={plan.plan === currentPlan}
                cancelAtPeriodEnd={plan.plan === currentPlan && cancelAtPeriodEnd}
                onSubscribe={paidPlan ? () => checkout.mutate(paidPlan) : undefined}
                onCancel={cancel.mutate}
                busy={checkout.isPending || cancel.isPending}
              />
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

function PlanCard({
  plan,
  isCurrent,
  cancelAtPeriodEnd,
  onSubscribe,
  onCancel,
  busy,
}: {
  plan: PlanOption;
  isCurrent: boolean;
  cancelAtPeriodEnd: boolean;
  onSubscribe?: (() => void) | undefined;
  onCancel: () => void;
  busy: boolean;
}): React.JSX.Element {
  return (
    <Card style={[styles.planCard, isCurrent ? styles.planCardCurrent : null]}>
      <View style={styles.planHeader}>
        <Text variant="displaySmall">{plan.label}</Text>
        <Text variant="bodyLarge" color="accent">
          {formatPlanPrice(plan)}
        </Text>
      </View>
      {isCurrent ? (
        <View style={styles.currentBadge}>
          <Text variant="labelSmall" color="inverse">
            {cancelAtPeriodEnd ? 'ENDS SOON' : 'CURRENT PLAN'}
          </Text>
        </View>
      ) : null}
      <View style={styles.features}>
        {plan.features.map((f) => (
          <View key={f} style={styles.feature}>
            <Ionicons name="checkmark" size={16} color={colors.amber.primary} />
            <Text variant="bodySmall" color="secondary" style={styles.flex}>
              {f}
            </Text>
          </View>
        ))}
      </View>
      {isCurrent && plan.plan !== 'free' && !cancelAtPeriodEnd ? (
        <Button label="Cancel subscription" variant="ghost" onPress={onCancel} disabled={busy} />
      ) : onSubscribe && !isCurrent ? (
        <Button label={`Choose ${plan.label}`} onPress={onSubscribe} loading={busy} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.base,
    paddingVertical: spacing.lg,
  },
  loader: {
    marginTop: spacing.xl,
  },
  flex: {
    flex: 1,
  },
  planCard: {
    gap: spacing.md,
  },
  planCardCurrent: {
    borderColor: colors.amber.primary,
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  currentBadge: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    backgroundColor: colors.amber.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  features: {
    gap: spacing.sm,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
