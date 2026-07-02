/**
 * Learn tab (ARCHITECTURE.md §7 "Learn"). Two sections: "Continue" (in-progress
 * lessons) and "All modules", grouped by track. Content + progress wiring land in
 * Phase 2; this is the routing scaffold.
 */

import { StyleSheet, View } from 'react-native';
import { Screen, Text } from '@/components/ui';
import { spacing } from '@/theme';

export default function Learn(): React.JSX.Element {
  return (
    <Screen>
      <Text variant="displayLarge" style={styles.title}>
        Learn
      </Text>
      <View style={styles.section}>
        <Text variant="bodyMedium" color="secondary">
          Lesson modules — Understanding Somali Music, The Pentatonic Scale, and more —
          arrive in Phase 2.
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
