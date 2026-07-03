/**
 * ArtistCard — a card in the Discover "featured artists" horizontal scroll
 * (SESSION P1-05). Geometric star placeholder avatar (no photos yet), name in
 * Playfair, and a recording-count badge. Presentational — parent wraps in a Link
 * to /artist/[id].
 */

import { StyleSheet, View } from 'react-native';
import { Card, Text } from '@/components/ui';
import { GeometricStar } from '@/components/auth/GeometricStar';
import type { ArtistSummary } from '@/utils/artists';
import { colors, spacing } from '@/theme';

export interface ArtistCardProps {
  artist: ArtistSummary;
}

export function ArtistCard({ artist }: ArtistCardProps): React.JSX.Element {
  return (
    <Card style={styles.card}>
      <View style={styles.avatar}>
        <GeometricStar size={44} />
      </View>
      <Text variant="displaySmall" numberOfLines={1} style={styles.name}>
        {artist.name}
      </Text>
      <Text variant="labelMedium" color="secondary">
        {artist.recordingCount} {artist.recordingCount === 1 ? 'recording' : 'recordings'}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 156,
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.tertiary,
    borderWidth: 1,
    borderColor: colors.border.primary,
  },
  name: {
    textAlign: 'center',
  },
});
