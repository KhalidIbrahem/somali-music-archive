/**
 * ModuleCard — a lesson module in the Learn tab (ARCHITECTURE.md §7): a number,
 * the title in Playfair, a short description, an amber progress bar, and the
 * lesson count. Presentational — the parent wraps it in a Link to /module/[id].
 */

import { StyleSheet, View } from 'react-native';
import type { LessonModule } from '@sma/types';
import { Card, Text } from '@/components/ui';
import { ProgressBar } from './ProgressBar';
import type { ModuleProgress } from '@/utils/lessons';
import { colors, spacing } from '@/theme';

export interface ModuleCardProps {
  index: number;
  module: LessonModule;
  progress: ModuleProgress;
}

export function ModuleCard({ index, module, progress }: ModuleCardProps): React.JSX.Element {
  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.number}>
          <Text variant="labelLarge" color="accent">
            {index}
          </Text>
        </View>
        <View style={styles.headerText}>
          <Text variant="displaySmall" numberOfLines={2}>
            {module.title}
          </Text>
          {module.description ? (
            <Text variant="bodySmall" color="secondary" numberOfLines={2}>
              {module.description}
            </Text>
          ) : null}
        </View>
      </View>

      <ProgressBar pct={progress.pct} />

      <View style={styles.footer}>
        <Text variant="labelMedium" color="secondary">
          {progress.completed} of {progress.total} lessons
        </Text>
        <Text variant="labelMedium" color="accent">
          {progress.pct}%
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  number: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.amber.subtle,
    borderWidth: 1,
    borderColor: colors.amber.dim,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
