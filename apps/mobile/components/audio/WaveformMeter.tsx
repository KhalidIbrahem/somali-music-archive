/**
 * WaveformMeter — a live bar waveform that reacts to the microphone input level
 * while recording (SESSION P1-03). Each bar has a fixed sensitivity multiplier so
 * the row looks organic; all are driven by the single `level` (0–1) shared value,
 * animated with Reanimated for smoothness.
 */

import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { colors } from '@/theme';

const BAR_COUNT = 32;

export interface WaveformMeterProps {
  /** Current input level, 0–1. */
  level: number;
}

export function WaveformMeter({ level }: WaveformMeterProps): React.JSX.Element {
  const shared = useSharedValue(0);

  // Per-bar sensitivity so bars don't move in lockstep. Stable across renders.
  const multipliers = useMemo(
    () => Array.from({ length: BAR_COUNT }, (_, i) => 0.5 + Math.abs(Math.sin(i * 1.3)) * 0.9),
    [],
  );

  useEffect(() => {
    shared.value = withTiming(level, { duration: 90 });
  }, [shared, level]);

  return (
    <View style={styles.row}>
      {multipliers.map((m, i) => (
        <Bar key={i} level={shared} multiplier={m} />
      ))}
    </View>
  );
}

function Bar({
  level,
  multiplier,
}: {
  level: SharedValue<number>;
  multiplier: number;
}): React.JSX.Element {
  const style = useAnimatedStyle(() => ({
    height: `${interpolate(Math.min(1, level.value * multiplier), [0, 1], [8, 100])}%`,
  }));
  return <Animated.View style={[styles.bar, style]} />;
}

const styles = StyleSheet.create({
  row: {
    height: 96,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 3,
  },
  bar: {
    flex: 1,
    minHeight: 4,
    borderRadius: 999,
    backgroundColor: colors.error,
  },
});
