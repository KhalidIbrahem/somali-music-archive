/**
 * Record tab (ARCHITECTURE.md §7 "Record" — role-gated to contributor/admin).
 *
 * The tab is hidden from the tab bar for listeners in `(tabs)/_layout.tsx`, but we
 * defend the route itself too: authorization is enforced at every layer, never
 * only in the UI chrome (§11). The full record → metadata → upload flow (direct to
 * R2 via presigned URL) is built in Phase 1.
 */

import { StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { Screen, Text } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { spacing } from '@/theme';

export default function Record(): React.JSX.Element {
  const role = useAuthStore((s) => s.user?.role ?? 'listener');
  if (role !== 'contributor' && role !== 'admin') {
    return <Redirect href="/(tabs)/discover" />;
  }

  return (
    <Screen>
      <Text variant="displayLarge" style={styles.title}>
        Record
      </Text>
      <View style={styles.section}>
        <Text variant="bodyMedium" color="secondary">
          Field recording — capture, review, add metadata, and upload directly to
          secure storage. Built in Phase 1.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.base,
  },
  section: {
    gap: spacing.md,
  },
});
