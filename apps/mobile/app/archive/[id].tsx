/**
 * Individual recording detail (ARCHITECTURE.md §7 "Individual Recording" modal).
 *
 * Full-screen dark: title, artist in amber, metadata chips, animated waveform,
 * AI description, and transcript tab. This scaffold fetches the recording and lays
 * out the header; the waveform player + tabs are built in Phase 2.
 */

import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { GENRE_LABELS } from '@sma/constants';
import { Screen, Text, Card } from '@/components/ui';
import { getRecording } from '@/services/api/recordings';
import { formatDuration } from '@/utils/formatters';
import { spacing } from '@/theme';

export default function RecordingDetail(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: recording, isLoading, isError } = useQuery({
    queryKey: ['recording', id],
    queryFn: () => getRecording(id),
    enabled: Boolean(id),
  });

  if (isLoading) {
    return (
      <Screen>
        <Text color="secondary">Loading…</Text>
      </Screen>
    );
  }
  if (isError || !recording) {
    return (
      <Screen>
        <Text color="error">Recording not found.</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <Text variant="displayLarge">{recording.title.somali}</Text>
        {recording.title.english ? (
          <Text variant="bodyMedium" color="secondary">
            {recording.title.english}
          </Text>
        ) : null}
        <Text variant="bodyLarge" color="accent" style={styles.artist}>
          {recording.artist.name}
        </Text>

        <View style={styles.chips}>
          <Text variant="labelLarge" color="secondary">
            {GENRE_LABELS[recording.genre]}
          </Text>
          {recording.era ? (
            <Text variant="labelLarge" color="secondary">
              · {recording.era}
            </Text>
          ) : null}
          <Text variant="labelLarge" color="secondary">
            · {formatDuration(recording.duration)}
          </Text>
        </View>

        {recording.ai.musicDescription ? (
          <Card style={styles.card}>
            <Text variant="labelLarge" color="secondary">
              ABOUT THIS RECORDING
            </Text>
            <Text variant="bodyMedium" style={styles.description}>
              {recording.ai.musicDescription}
            </Text>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  artist: {
    marginTop: spacing.xs,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  card: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  description: {
    lineHeight: 22,
  },
});
