/**
 * Discover tab (ARCHITECTURE.md §7 "Discover"). Browses the archive: featured
 * artists (horizontal) + recent recordings (vertical), filterable by genre.
 *
 * Server data is fetched via React Query — never stored in Zustand (§6). This
 * scaffold wires the query + list; rich cards and the genre filter bar land in
 * Phase 2.
 */

import { FlatList, StyleSheet, View } from 'react-native';
import { Link } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { GENRE_LABELS } from '@sma/constants';
import type { PublicRecording } from '@sma/types';
import { Screen, Text, Card } from '@/components/ui';
import { listRecordings } from '@/services/api/recordings';
import { formatDuration } from '@/utils/formatters';
import { spacing } from '@/theme';

export default function Discover(): React.JSX.Element {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['recordings', { page: 1 }],
    queryFn: () => listRecordings({ page: 1, limit: 20 }),
  });

  return (
    <Screen>
      <Text variant="displayLarge" style={styles.title}>
        Discover
      </Text>

      {isLoading ? (
        <Text color="secondary">Loading the archive…</Text>
      ) : isError ? (
        <Text color="error">Could not load recordings. Pull to retry.</Text>
      ) : (
        <FlatList
          data={data?.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text color="secondary">No recordings yet.</Text>}
          renderItem={({ item }: { item: PublicRecording }) => (
            <Link href={`/archive/${item.id}`} asChild>
              <Card>
                <Text variant="displaySmall">{item.title.somali}</Text>
                <View style={styles.meta}>
                  <Text variant="bodySmall" color="accent">
                    {item.artist.name}
                  </Text>
                  <Text variant="bodySmall" color="secondary">
                    {GENRE_LABELS[item.genre]} · {formatDuration(item.duration)}
                  </Text>
                </View>
              </Card>
            </Link>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.base,
  },
  list: {
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  meta: {
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
});
