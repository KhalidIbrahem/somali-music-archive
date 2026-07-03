/**
 * RecordingCard — a row in the archive list (SESSION P1-05). Dark surface with an
 * amber accent bar, title in Playfair, artist in amber, and a genre · duration
 * line, plus a small static waveform motif. Presentational — the parent wraps it
 * in a Link to /archive/[id].
 */

import { StyleSheet, View } from 'react-native';
import { GENRE_LABELS } from '@sma/constants';
import type { PublicRecording } from '@sma/types';
import { Card, Text } from '@/components/ui';
import { formatDuration } from '@/utils/formatters';
import { colors, spacing } from '@/theme';

/** Deterministic bar heights so a card's thumbnail is stable across renders. */
function thumbBars(seed: string): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 997;
  return Array.from({ length: 10 }, (_, i) => 0.3 + ((h + i * 37) % 70) / 100);
}

export interface RecordingCardProps {
  recording: PublicRecording;
}

export function RecordingCard({ recording }: RecordingCardProps): React.JSX.Element {
  const bars = thumbBars(recording.id);
  return (
    <Card style={styles.card}>
      <View style={styles.accent} />
      <View style={styles.thumb}>
        {bars.map((b, i) => (
          <View key={i} style={[styles.thumbBar, { height: `${b * 100}%` }]} />
        ))}
      </View>
      <View style={styles.body}>
        <Text variant="displaySmall" numberOfLines={1}>
          {recording.title.somali}
        </Text>
        <Text variant="bodySmall" color="accent" numberOfLines={1}>
          {recording.artist.name}
        </Text>
        <Text variant="labelMedium" color="secondary">
          {GENRE_LABELS[recording.genre]} · {formatDuration(recording.duration)}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    overflow: 'hidden',
  },
  accent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: colors.amber.primary,
  },
  thumb: {
    width: 56,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: spacing.xs,
  },
  thumbBar: {
    flex: 1,
    minHeight: 3,
    borderRadius: 999,
    backgroundColor: colors.amber.dim,
  },
  body: {
    flex: 1,
    gap: 2,
  },
});
