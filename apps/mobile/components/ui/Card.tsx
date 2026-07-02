/**
 * Card — an elevated surface for grouping content (recording rows, artist cards).
 * Uses the surface color steps + a subtle shadow for depth on the dark background.
 */

import { View, StyleSheet, type ViewProps } from 'react-native';
import { colors, radius, spacing, shadows, type ShadowToken } from '@/theme';

export interface CardProps extends ViewProps {
  elevation?: ShadowToken;
}

export function Card({
  elevation = 'sm',
  style,
  ...rest
}: CardProps): React.JSX.Element {
  return <View style={[styles.card, shadows[elevation], style]} {...rest} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.secondary,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border.secondary,
  },
});
