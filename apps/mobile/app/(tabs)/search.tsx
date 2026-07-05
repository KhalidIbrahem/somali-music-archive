/**
 * Search tab (SESSION P2-03, ARCHITECTURE.md §7, §12 SEARCH).
 *
 * Debounced free-text search across the archive (title, artist, genre, era…) with
 * a genre facet, backed by GET /search. Results reuse RecordingCard and link to the
 * recording detail. Phase 2/3 swaps the backend to MongoDB text search / Elasticsearch
 * behind the same endpoint.
 */

import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Link } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { Genre } from '@sma/constants';
import type { PublicRecording } from '@sma/types';
import { Screen, Text, Input } from '@/components/ui';
import { RecordingCard } from '@/components/archive/RecordingCard';
import { searchRecordings } from '@/services/api/search';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
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
  { label: 'Buraanbur', value: 'buraanbur' },
  { label: 'Instrumental', value: 'instrumental' },
];

export default function Search(): React.JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState<Genre | null>(null);
  const debounced = useDebouncedValue(query.trim(), 300);

  const active = debounced.length > 0 || genre !== null;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['search', debounced, genre],
    queryFn: () =>
      searchRecordings({
        ...(debounced ? { q: debounced } : {}),
        ...(genre ? { genre } : {}),
        limit: 30,
      }),
    enabled: active,
  });

  const results = data?.data ?? [];

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Text variant="displayLarge" style={styles.title}>
          {t('tabs.search')}
        </Text>
        <Input
          label={t('search.label')}
          value={query}
          onChangeText={setQuery}
          placeholder={t('search.placeholder')}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        <View style={styles.filterRow}>
          {FILTERS.map((filter) => {
            const isActive = genre === filter.value;
            return (
              <Pressable
                key={filter.label}
                onPress={() => setGenre(filter.value)}
                style={[styles.chip, isActive ? styles.chipActive : null]}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
              >
                <Text variant="labelMedium" color={isActive ? 'inverse' : 'secondary'}>
                  {filter.value === null ? t('common.all') : filter.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        renderItem={({ item }: { item: PublicRecording }) => (
          <Link href={`/archive/${item.id}`} asChild>
            <Pressable style={styles.cardWrap}>
              <RecordingCard recording={item} />
            </Pressable>
          </Link>
        )}
        ListEmptyComponent={
          !active ? (
            <Text color="secondary" style={styles.state}>
              {t('search.hint')}
            </Text>
          ) : isLoading ? (
            <Text color="secondary" style={styles.state}>
              {t('search.searching')}
            </Text>
          ) : isError ? (
            <Text color="error" style={styles.state}>
              {t('search.failed')}
            </Text>
          ) : (
            <Text color="secondary" style={styles.state}>
              {t('search.noResults', {
                query: debounced || (FILTERS.find((f) => f.value === genre)?.label ?? ''),
              })}
            </Text>
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.base,
    gap: spacing.base,
  },
  title: {
    paddingTop: spacing.lg,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border.primary,
    backgroundColor: colors.bg.secondary,
  },
  chipActive: {
    backgroundColor: colors.amber.primary,
    borderColor: colors.amber.primary,
  },
  list: {
    padding: spacing.base,
  },
  cardWrap: {
    marginBottom: spacing.md,
  },
  state: {
    paddingVertical: spacing.xxl,
    textAlign: 'center',
  },
});
