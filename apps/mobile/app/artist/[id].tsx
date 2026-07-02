/**
 * Artist profile (ARCHITECTURE.md §7). Honors contributing elder musicians as
 * co-creators (Principle 5): name, bio, affiliations, and their recordings.
 * Data wiring lands in Phase 2; this is the modal route scaffold.
 */

import { StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Screen, Text } from '@/components/ui';
import { spacing } from '@/theme';

export default function ArtistProfile(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <Screen>
      <Text variant="displayLarge" style={styles.title}>
        Artist
      </Text>
      <Text variant="bodyMedium" color="secondary">
        Profile for artist {id} — bio, affiliations, and recordings (Phase 2).
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.base,
  },
});
