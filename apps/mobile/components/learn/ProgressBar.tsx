/**
 * ProgressBar — a thin amber completion bar for lesson modules (ARCHITECTURE.md §7).
 */

import { StyleSheet, View } from 'react-native';
import { colors } from '@/theme';

export interface ProgressBarProps {
  /** 0–100. */
  pct: number;
  height?: number;
}

export function ProgressBar({ pct, height = 6 }: ProgressBarProps): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <View
      style={[styles.track, { height }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
    >
      <View style={[styles.fill, { width: `${clamped}%`, height }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    borderRadius: 999,
    backgroundColor: colors.border.primary,
    overflow: 'hidden',
  },
  fill: {
    borderRadius: 999,
    backgroundColor: colors.amber.primary,
  },
});
