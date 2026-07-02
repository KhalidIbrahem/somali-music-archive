/**
 * Profile tab (ARCHITECTURE.md §7 "Profile"). Account, subscription badge, stats,
 * settings, and sign out. This scaffold shows identity + logout; stats and
 * settings arrive in Phase 2.
 */

import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Screen, Text, Card, Button } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { spacing } from '@/theme';

export default function Profile(): React.JSX.Element {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const onLogout = async (): Promise<void> => {
    await logout();
    router.replace('/(auth)/welcome');
  };

  return (
    <Screen>
      <Text variant="displayLarge" style={styles.title}>
        Profile
      </Text>

      <Card style={styles.card}>
        <Text variant="displaySmall">{user?.displayName ?? 'Guest'}</Text>
        <Text variant="bodySmall" color="secondary">
          {user?.email ?? ''}
        </Text>
        {user ? (
          <Text variant="labelLarge" color="accent" style={styles.role}>
            {user.role.toUpperCase()}
          </Text>
        ) : null}
      </Card>

      <View style={styles.actions}>
        <Button label="Sign out" variant="secondary" onPress={onLogout} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.base,
  },
  card: {
    gap: spacing.xs,
  },
  role: {
    marginTop: spacing.sm,
  },
  actions: {
    marginTop: spacing.xl,
  },
});
