/**
 * Full archive list (ARCHITECTURE.md §6 archive routes). The Discover tab surfaces
 * a curated feed; this route is the exhaustive, paginated browse of everything
 * published. Filters + infinite scroll land in Phase 2.
 */

import { FlatList, StyleSheet } from 'react-native';
import { Link } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { PublicRecording } from '@sma/types';
import { Screen, Text, Card } from '@/components/ui';
import { listRecordings } from '@/services/api/recordings';
import { formatDuration } from '@/utils/formatters';
import { spacing } from '@/theme';

export default function ArchiveIndex(): React.JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['recordings', 'all'],
    queryFn: () => listRecordings({ page: 1, limit: 50 }),
  });

  return (
    <Screen>
      <Text variant="displayMedium" style={styles.title}>
        Archive
      </Text>
      {isLoading ? (
        <Text color="secondary">Loading…</Text>
      ) : (
        <FlatList
          data={data?.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }: { item: PublicRecording }) => (
            <Link href={`/archive/${item.id}`} asChild>
              <Card>
                <Text variant="bodyLarge">{item.title.somali}</Text>
                <Text variant="bodySmall" color="secondary">
                  {item.artist.name} · {formatDuration(item.duration)}
                </Text>
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
});
