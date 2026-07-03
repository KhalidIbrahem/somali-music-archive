/**
 * Profile tab (SESSION P2-04, ARCHITECTURE.md §7 "Profile").
 *
 * Avatar + name/email, a subscription badge, stats (saved recordings, lessons
 * completed), settings (UI language — server-synced; playback quality, offline
 * downloads, notifications — device prefs), and sign out.
 */

import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Link, router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UI_LANGUAGES, LANGUAGE_DESCRIPTORS, type UiLanguage } from '@sma/constants';
import { Screen, Text, Card, Button } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore, type PlaybackQuality } from '@/stores/settingsStore';
import { getSaved, updateProfile } from '@/services/api/users';
import { getMyProgress } from '@/services/api/lessons';
import { getSubscriptionStatus } from '@/services/api/subscriptions';
import { sendTestNotification } from '@/services/api/notifications';
import { audioCache } from '@/services/audio/cache';
import { formatFileSize } from '@/utils/formatters';
import { colors, radius, spacing } from '@/theme';

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default function Profile(): React.JSX.Element {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const updateUser = useAuthStore((s) => s.updateUser);
  const settings = useSettingsStore();
  const queryClient = useQueryClient();

  const savedQuery = useQuery({ queryKey: ['saved'], queryFn: getSaved });
  const progressQuery = useQuery({ queryKey: ['lesson-progress'], queryFn: getMyProgress });
  const subscriptionQuery = useQuery({
    queryKey: ['subscription-status'],
    queryFn: getSubscriptionStatus,
  });

  const languageMutation = useMutation({
    mutationFn: (language: UiLanguage) => updateProfile({ language }),
    onSuccess: (updated) => {
      updateUser({ language: updated.language });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const testPush = useMutation({ mutationFn: sendTestNotification });
  const downloadsSizeQuery = useQuery({
    queryKey: ['downloads-size'],
    queryFn: () => audioCache.totalSize(),
  });
  const clearDownloads = useMutation({
    mutationFn: () => audioCache.clear(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['downloads-size'] }),
  });

  const savedCount = savedQuery.data?.length ?? 0;
  const lessonsCompleted = (progressQuery.data ?? []).filter((p) => p.completed).length;

  const onLogout = async (): Promise<void> => {
    await logout();
    router.replace('/(auth)/welcome');
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text variant="displayLarge" style={styles.title}>
          Profile
        </Text>

        {/* Identity */}
        <Card style={styles.identity}>
          <View style={styles.avatar}>
            <Text variant="displaySmall" color="accent">
              {user ? initials(user.displayName) : '—'}
            </Text>
          </View>
          <View style={styles.identityText}>
            <Text variant="displaySmall" numberOfLines={1}>
              {user?.displayName ?? 'Guest'}
            </Text>
            <Text variant="bodySmall" color="secondary" numberOfLines={1}>
              {user?.email ?? ''}
            </Text>
            <Link href="/subscription" asChild>
              <Pressable style={styles.badge}>
                <Text variant="labelSmall" color="inverse">
                  {(subscriptionQuery.data?.plan ?? 'free').toUpperCase()}
                </Text>
              </Pressable>
            </Link>
          </View>
        </Card>

        {/* Stats */}
        <View style={styles.stats}>
          <Link href="/saved" asChild>
            <Pressable style={styles.flex}>
              <Stat value={savedCount} label="Saved" />
            </Pressable>
          </Link>
          <Stat value={lessonsCompleted} label="Lessons done" />
        </View>

        {/* Language (server-synced) */}
        <Section title="LANGUAGE">
          <View style={styles.langRow}>
            {UI_LANGUAGES.map((code) => {
              const active = user?.language === code;
              return (
                <Pressable
                  key={code}
                  onPress={() => languageMutation.mutate(code)}
                  disabled={languageMutation.isPending}
                  style={[styles.langChip, active ? styles.langChipActive : null]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <Text variant="bodyMedium" color={active ? 'inverse' : 'primary'}>
                    {LANGUAGE_DESCRIPTORS[code]?.nativeName ?? code}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        {/* Playback quality */}
        <Section title="PLAYBACK QUALITY">
          <View style={styles.langRow}>
            {(['standard', 'high'] as PlaybackQuality[]).map((q) => {
              const active = settings.playbackQuality === q;
              return (
                <Pressable
                  key={q}
                  onPress={() => settings.setPlaybackQuality(q)}
                  style={[styles.langChip, active ? styles.langChipActive : null]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <Text variant="bodyMedium" color={active ? 'inverse' : 'primary'}>
                    {q === 'high' ? 'High' : 'Standard'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        {/* Toggles */}
        <Card style={styles.toggles}>
          <ToggleRow
            label="Offline downloads"
            value={settings.offlineDownloads}
            onValueChange={settings.setOfflineDownloads}
          />
          <ToggleRow
            label="Notifications"
            value={settings.notifications}
            onValueChange={settings.setNotifications}
          />
        </Card>

        {settings.notifications ? (
          <Button
            label={testPush.isSuccess ? 'Test notification sent' : 'Send test notification'}
            variant="ghost"
            onPress={() => testPush.mutate()}
            loading={testPush.isPending}
          />
        ) : null}

        {(downloadsSizeQuery.data ?? 0) > 0 ? (
          <Button
            label={`Clear downloads (${formatFileSize(downloadsSizeQuery.data ?? 0)})`}
            variant="ghost"
            onPress={() => clearDownloads.mutate()}
            loading={clearDownloads.isPending}
          />
        ) : null}

        <Button label="Sign out" variant="secondary" onPress={onLogout} />
      </ScrollView>
    </Screen>
  );
}

function Stat({ value, label }: { value: number; label: string }): React.JSX.Element {
  return (
    <Card style={styles.stat}>
      <Text variant="displayMedium" color="accent">
        {value}
      </Text>
      <Text variant="labelMedium" color="secondary">
        {label}
      </Text>
    </Card>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text variant="labelLarge" color="secondary">
        {title}
      </Text>
      {children}
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}): React.JSX.Element {
  return (
    <View style={styles.toggleRow}>
      <Text variant="bodyLarge">{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: colors.amber.primary, false: colors.border.primary }}
        thumbColor={colors.text.primary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  title: {
    paddingTop: spacing.lg,
  },
  flex: {
    flex: 1,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.tertiary,
    borderWidth: 1,
    borderColor: colors.amber.dim,
  },
  identityText: {
    flex: 1,
    gap: spacing.xs,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    backgroundColor: colors.amber.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginTop: spacing.xs,
  },
  stats: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  section: {
    gap: spacing.sm,
  },
  langRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  langChip: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.primary,
    backgroundColor: colors.bg.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langChipActive: {
    backgroundColor: colors.amber.primary,
    borderColor: colors.amber.primary,
  },
  toggles: {
    gap: spacing.md,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
