/**
 * Lesson player (ARCHITECTURE.md §7 "Lesson Player" modal). Progress bar, rich
 * content blocks with embedded archive audio, and an interactive pitch exercise
 * (microphone listens, meter shows closeness). Built in Phase 2/3; this is the
 * modal route scaffold.
 */

import { StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Screen, Text } from '@/components/ui';
import { spacing } from '@/theme';

export default function LessonPlayer(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <Screen>
      <Text variant="displayLarge" style={styles.title}>
        Lesson
      </Text>
      <Text variant="bodyMedium" color="secondary">
        Lesson {id} — content blocks and the pitch exercise arrive in Phase 2.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.base,
  },
});
