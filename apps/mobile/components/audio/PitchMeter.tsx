/**
 * PitchMeter — visual feedback for the pitch exercise (ARCHITECTURE.md §7).
 * A horizontal scale (flat ← in tune → sharp) with a marker positioned by the
 * cents deviation, plus an accuracy score. Green when in tune, amber when off.
 */

import { StyleSheet, View } from 'react-native';
import type { PitchAccuracy } from '@/utils/pitch';
import { Text } from '@/components/ui';
import { colors, spacing } from '@/theme';

export interface PitchMeterProps {
  result: PitchAccuracy | null;
}

export function PitchMeter({ result }: PitchMeterProps): React.JSX.Element {
  // Map cents (-100..100) to 0..1 across the track; center (0.5) is in tune.
  const cents = result?.cents ?? 0;
  const position = Math.max(0, Math.min(1, (cents + 100) / 200));
  const markerColor = result?.inTune ? colors.success : colors.amber.primary;

  const label = !result
    ? 'Sing the note to hear how close you are'
    : result.inTune
      ? 'In tune ✓'
      : cents < 0
        ? 'A little flat'
        : 'A little sharp';

  return (
    <View style={styles.wrapper}>
      <View style={styles.scale}>
        <View style={styles.centerLine} />
        {result ? (
          <View
            style={[styles.marker, { left: `${position * 100}%`, backgroundColor: markerColor }]}
          />
        ) : null}
      </View>
      <View style={styles.legend}>
        <Text variant="labelSmall" color="tertiary">
          Flat
        </Text>
        <Text variant="labelSmall" color="tertiary">
          In tune
        </Text>
        <Text variant="labelSmall" color="tertiary">
          Sharp
        </Text>
      </View>
      <View style={styles.readout}>
        <Text variant="bodyMedium" color={result?.inTune ? 'success' : 'secondary'}>
          {label}
        </Text>
        {result ? (
          <Text variant="displaySmall" color="accent">
            {result.accuracy}%
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.sm,
  },
  scale: {
    height: 40,
    borderRadius: 8,
    backgroundColor: colors.bg.tertiary,
    justifyContent: 'center',
  },
  centerLine: {
    position: 'absolute',
    left: '50%',
    top: 6,
    bottom: 6,
    width: 2,
    marginLeft: -1,
    backgroundColor: colors.border.primary,
  },
  marker: {
    position: 'absolute',
    width: 8,
    height: 28,
    borderRadius: 4,
    marginLeft: -4,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  readout: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
