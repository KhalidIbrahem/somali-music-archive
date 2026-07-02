/**
 * Search tab (ARCHITECTURE.md §7, §12 SEARCH). Full-text across titles, artists,
 * genres, regions and (later) transcripts. Phase 2 uses MongoDB text search;
 * Phase 3 swaps in Elasticsearch behind the same endpoint.
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Screen, Text, Input } from '@/components/ui';
import { spacing } from '@/theme';

export default function Search(): React.JSX.Element {
  const [query, setQuery] = useState('');

  return (
    <Screen>
      <Text variant="displayLarge" style={styles.title}>
        Search
      </Text>
      <View style={styles.field}>
        <Input
          label="Find a song, artist, or genre"
          value={query}
          onChangeText={setQuery}
          placeholder="e.g. Hobalaha, dhaanto…"
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>
      <Text variant="bodyMedium" color="secondary">
        Results appear as you type (Phase 2).
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.base,
  },
  field: {
    paddingBottom: spacing.base,
  },
});
