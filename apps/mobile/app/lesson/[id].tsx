/**
 * Lesson player (SESSION P2-02, ARCHITECTURE.md §7 "Lesson Player").
 *
 * Progress bar + "Lesson N of M" + title, the lesson's content blocks (text,
 * embedded archive audio, interactive pitch exercise), and a complete → next-lesson
 * action that records progress via POST /lessons/:id/progress.
 */

import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen, Text, Button } from '@/components/ui';
import { ProgressBar } from '@/components/learn/ProgressBar';
import { LessonBlockView } from '@/components/learn/LessonBlockView';
import { getLesson, getModule, updateProgress } from '@/services/api/lessons';
import { colors, spacing } from '@/theme';

export default function LessonPlayer(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const {
    data: lesson,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['lesson', id],
    queryFn: () => getLesson(id),
    enabled: Boolean(id),
  });

  const { data: module } = useQuery({
    queryKey: ['lesson-module', lesson?.moduleId],
    queryFn: () => getModule(lesson?.moduleId ?? ''),
    enabled: Boolean(lesson?.moduleId),
  });

  const complete = useMutation({
    mutationFn: () => updateProgress(id, { progressPct: 100, lastPositionSec: 0, completed: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lesson-progress'] });
    },
  });

  if (isLoading) {
    return (
      <Screen>
        <ActivityIndicator color={colors.amber.primary} style={styles.loader} />
      </Screen>
    );
  }
  if (isError || !lesson) {
    return (
      <Screen>
        <Text color="error">Lesson not found.</Text>
      </Screen>
    );
  }

  const index = module ? module.lessonIds.indexOf(lesson.id) : -1;
  const total = module?.lessonCount ?? 0;
  const nextId = index >= 0 ? module?.lessonIds[index + 1] : undefined;
  const positionPct = total > 0 && index >= 0 ? ((index + 1) / total) * 100 : 0;

  const onComplete = async (): Promise<void> => {
    await complete.mutateAsync();
    if (nextId) {
      router.replace(`/lesson/${nextId}`);
    } else {
      router.back();
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        {total > 0 ? <ProgressBar pct={positionPct} /> : null}
        {index >= 0 ? (
          <Text variant="labelLarge" color="secondary">
            LESSON {index + 1} OF {total}
          </Text>
        ) : null}
        <Text variant="displayMedium">{lesson.title}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.blocks}>
          {lesson.blocks.map((block, i) => (
            <LessonBlockView key={i} block={block} />
          ))}
        </View>

        <Button
          label={nextId ? 'Complete & next lesson' : 'Complete lesson'}
          onPress={onComplete}
          loading={complete.isPending}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loader: {
    marginTop: spacing.xxxl,
  },
  header: {
    gap: spacing.sm,
    paddingTop: spacing.base,
    paddingBottom: spacing.base,
  },
  content: {
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
  blocks: {
    gap: spacing.xl,
  },
});
