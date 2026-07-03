/**
 * Module detail — the lesson list for a module (SESSION P2-01, ARCHITECTURE.md §7).
 * Tapping a lesson opens the lesson player (/lesson/[id], built in P2-02).
 */

import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import type { Lesson } from '@sma/types';
import { Screen, Text, Card } from '@/components/ui';
import { getModule } from '@/services/api/lessons';
import { colors, spacing } from '@/theme';

export default function ModuleDetail(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    data: module,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['lesson-module', id],
    queryFn: () => getModule(id),
    enabled: Boolean(id),
  });

  if (isLoading) {
    return (
      <Screen>
        <ActivityIndicator color={colors.amber.primary} style={styles.loader} />
      </Screen>
    );
  }
  if (isError || !module) {
    return (
      <Screen>
        <Text color="error">Module not found.</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text variant="displayLarge">{module.title}</Text>
        {module.description ? (
          <Text variant="bodyMedium" color="secondary" style={styles.description}>
            {module.description}
          </Text>
        ) : null}

        <View style={styles.list}>
          {module.lessons.map((lesson: Lesson) => (
            <Link key={lesson.id} href={`/lesson/${lesson.id}`} asChild>
              <Pressable>
                <Card style={styles.lessonRow}>
                  <View style={styles.lessonNumber}>
                    <Text variant="labelLarge" color="accent">
                      {lesson.order}
                    </Text>
                  </View>
                  <View style={styles.lessonBody}>
                    <Text variant="bodyLarge" numberOfLines={2}>
                      {lesson.title}
                    </Text>
                    {lesson.estimatedMinutes ? (
                      <Text variant="labelMedium" color="secondary">
                        {lesson.estimatedMinutes} min
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.text.secondary} />
                </Card>
              </Pressable>
            </Link>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loader: {
    marginTop: spacing.xxxl,
  },
  content: {
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  description: {
    marginBottom: spacing.base,
  },
  list: {
    gap: spacing.md,
  },
  lessonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  lessonNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.amber.subtle,
    borderWidth: 1,
    borderColor: colors.amber.dim,
  },
  lessonBody: {
    flex: 1,
    gap: 2,
  },
});
