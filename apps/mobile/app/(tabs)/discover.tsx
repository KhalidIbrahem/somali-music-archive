/**
 * Discover tab (SESSION P1-05, ARCHITECTURE.md §7 "Discover").
 *
 * Browses the archive: a horizontal scroll of featured artists, a genre filter bar,
 * and an infinite-scrolling list of recent recordings (React Query `useInfiniteQuery`).
 * Server data only — never stored in Zustand (§6).
 */

import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Link } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { Genre } from '@sma/constants';
import type { PublicRecording } from '@sma/types';
import { Screen, Text } from '@/components/ui';
import { RecordingCard } from '@/components/archive/RecordingCard';
import { ArtistCard } from '@/components/archive/ArtistCard';
import { listRecordings } from '@/services/api/recordings';
import { deriveFeaturedArtists } from '@/utils/artists';
import { useTranslation } from '@/i18n';
import { colors, radius, spacing } from '@/theme';

interface GenreFilter {
  label: string;
  value: Genre | null;
}

const FILTERS: readonly GenreFilter[] = [
  { label: 'All', value: null },
  { label: 'Heello', value: 'heello' },
  { label: 'Qaraami', value: 'qaraami' },
  { label: 'Dhaanto', value: 'dhaanto' },
  { label: 'Instrumental', value: 'instrumental' },
];

export default function Discover(): React.JSX.Element {
  const { t } = useTranslation();
  const [genre, setGenre] = useState<Genre | null>(null);

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['recordings', genre],
      queryFn: ({ pageParam }) =>
        listRecordings({ ...(genre ? { genre } : {}), page: pageParam, limit: 20 }),
      initialPageParam: 1,
      getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    });

  const recordings = data?.pages.flatMap((p) => p.data) ?? [];
  const featured = deriveFeaturedArtists(recordings, 10);

  return (
    <Screen padded={false}>
      <FlatList
        data={recordings}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        ListHeaderComponent={
          <View>
            <Text variant="displayLarge" style={styles.title}>
              {t('tabs.discover')}
            </Text>

            {featured.length > 0 ? (
              <View style={styles.section}>
                <Text variant="labelLarge" color="secondary" style={styles.sectionLabel}>
                  {t('discover.featuredArtists').toUpperCase()}
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.artistRow}
                >
                  {featured.map((artist) => (
                    <Link key={artist.id} href={`/artist/${artist.id}`} asChild>
                      <Pressable>
                        <ArtistCard artist={artist} />
                      </Pressable>
                    </Link>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              {FILTERS.map((filter) => {
                const active = genre === filter.value;
                return (
                  <Pressable
                    key={filter.label}
                    onPress={() => setGenre(filter.value)}
                    style={[styles.filterChip, active ? styles.filterChipActive : null]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text variant="labelLarge" color={active ? 'inverse' : 'secondary'}>
                      {filter.value === null ? t('common.all') : filter.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text variant="labelLarge" color="secondary" style={styles.sectionLabel}>
              {t('discover.recentRecordings').toUpperCase()}
            </Text>
          </View>
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
            <Text color="secondary" style={styles.pad}>
              {t('discover.loading')}
            </Text>
          ) : isError ? (
            <Text color="error" style={styles.pad}>
              {t('discover.loadError')}
            </Text>
          ) : (
            <View style={styles.empty}>
              <Text variant="displaySmall" style={styles.center}>
                {t('discover.emptyTitle')}
              </Text>
              <Text variant="bodyMedium" color="secondary" style={styles.center}>
                {t('discover.emptyBody')}
              </Text>
            </View>
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
  section: {
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    marginBottom: spacing.sm,
  },
  artistRow: {
    gap: spacing.md,
    paddingRight: spacing.base,
  },
  filterRow: {
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
  filterChip: {
    minHeight: 36,
    paddingHorizontal: spacing.base,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border.primary,
    backgroundColor: colors.bg.secondary,
  },
  filterChipActive: {
    backgroundColor: colors.amber.primary,
    borderColor: colors.amber.primary,
  },
  cardWrap: {
    marginBottom: spacing.md,
  },
  pad: {
    paddingVertical: spacing.xl,
  },
  center: {
    textAlign: 'center',
  },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxxl,
  },
});
