/**
 * Learn tab (SESSION P2-01, ARCHITECTURE.md §7 "Learn").
 *
 * Two sections: "Continue" (modules the learner has started) and "All modules",
 * grouped by track (Beginner / Intermediate / Advanced). Module cards show an amber
 * progress bar computed from the learner's lesson progress. Tapping a module opens
 * its lesson list. Server data via React Query.
 */

import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Link } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { LessonModule } from '@sma/types';
import { Screen, Text } from '@/components/ui';
import { ModuleCard } from '@/components/learn/ModuleCard';
import { getModules, getMyProgress } from '@/services/api/lessons';
import { computeModuleProgress, groupModulesByTrack, inProgressModules } from '@/utils/lessons';
import { useTranslation } from '@/i18n';
import { spacing } from '@/theme';

export default function Learn(): React.JSX.Element {
  const { t } = useTranslation();
  const modulesQuery = useQuery({ queryKey: ['lesson-modules'], queryFn: getModules });
  const progressQuery = useQuery({ queryKey: ['lesson-progress'], queryFn: getMyProgress });

  const modules = modulesQuery.data ?? [];
  const progress = progressQuery.data ?? [];
  const continueModules = inProgressModules(modules, progress);
  const groups = groupModulesByTrack(modules);

  const renderModule = (module: LessonModule): React.JSX.Element => (
    <Link key={module.id} href={`/module/${module.id}`} asChild>
      <Pressable style={styles.cardWrap}>
        <ModuleCard
          index={module.order}
          module={module}
          progress={computeModuleProgress(module, progress)}
        />
      </Pressable>
    </Link>
  );

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text variant="displayLarge" style={styles.title}>
          {t('tabs.learn')}
        </Text>

        {modulesQuery.isLoading ? (
          <Text color="secondary">{t('learn.loadingModules')}</Text>
        ) : modulesQuery.isError ? (
          <Text color="error">{t('learn.loadError')}</Text>
        ) : (
          <>
            {continueModules.length > 0 ? (
              <View style={styles.section}>
                <Text variant="labelLarge" color="secondary" style={styles.sectionLabel}>
                  {t('learn.continue').toUpperCase()}
                </Text>
                {continueModules.map(renderModule)}
              </View>
            ) : null}

            {groups.map((group) => (
              <View key={group.track} style={styles.section}>
                <Text variant="labelLarge" color="secondary" style={styles.sectionLabel}>
                  {t(`learn.track.${group.track}`).toUpperCase()}
                </Text>
                {group.modules.map(renderModule)}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.xxl,
  },
  title: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.base,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    marginBottom: spacing.sm,
  },
  cardWrap: {
    marginBottom: spacing.md,
  },
});
