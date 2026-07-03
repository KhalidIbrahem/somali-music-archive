/**
 * Saved recordings (SESSION P2-04, ARCHITECTURE.md §12 GET /users/me/saved).
 * The learner's bookmarks, saved from the recording detail screen.
 */

import { FlatList, Pressable, StyleSheet } from 'react-native';
import { Link } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { PublicRecording } from '@sma/types';
import { Screen, Text } from '@/components/ui';
import { RecordingCard } from '@/components/archive/RecordingCard';
import { getSaved } from '@/services/api/users';
import { spacing } from '@/theme';

export default function Saved(): React.JSX.Element {
  const { data, isLoading, isError } = useQuery({ queryKey: ['saved'], queryFn: getSaved });
  const saved = data ?? [];

  return (
    <Screen padded={false}>
      <FlatList
        data={saved}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <Text variant="displayLarge" style={styles.title}>
            Saved
          </Text>
        }
        renderItem={({ item }: { item: PublicRecording }) => (
          <Link href={`/archive/${item.id}`} asChild>
            <Pressable style={styles.cardWrap}>
              <RecordingCard recording={item} />
            </Pressable>
          </Link>
        )}
        ListEmptyComponent={
          isLoading ? (
            <Text color="secondary" style={styles.state}>
              Loading…
            </Text>
          ) : isError ? (
            <Text color="error" style={styles.state}>
              Could not load your saved recordings.
            </Text>
          ) : (
            <Text color="secondary" style={styles.state}>
              Nothing saved yet. Tap “Save” on any recording to keep it here.
            </Text>
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.xxl,
  },
  title: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.base,
  },
  cardWrap: {
    marginBottom: spacing.md,
  },
  state: {
    paddingVertical: spacing.xxl,
    textAlign: 'center',
  },
});
