/**
 * RecordButton — the large centred control (SESSION P1-03).
 *   • idle: an amber mic in a softly pulsing ring ("press to begin"),
 *   • recording: a red stop-square with a stronger pulse.
 * Pulse is driven by Reanimated. 88pt+ target, well above the 44pt minimum.
 */

import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, shadows } from '@/theme';

const SIZE = 96;

export interface RecordButtonProps {
  isRecording: boolean;
  onPress: () => void;
  disabled?: boolean;
}

export function RecordButton({
  isRecording,
  onPress,
  disabled = false,
}: RecordButtonProps): React.JSX.Element {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: isRecording ? 900 : 1600, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [pulse, isRecording]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.35 * (1 - pulse.value),
    transform: [{ scale: 1 + pulse.value * (isRecording ? 0.5 : 0.35) }],
  }));

  const tint = isRecording ? colors.error : colors.amber.primary;

  return (
    <View style={styles.container}>
      <Animated.View
        style={[styles.ring, ringStyle, { backgroundColor: tint }]}
        pointerEvents="none"
      />
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording'}
        accessibilityState={{ disabled }}
        style={[
          styles.button,
          shadows.lg,
          { backgroundColor: tint },
          disabled ? styles.disabled : null,
        ]}
      >
        {isRecording ? (
          <View style={styles.stopSquare} />
        ) : (
          <Ionicons name="mic" size={40} color={colors.text.inverse} />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
  },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopSquare: {
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: colors.text.inverse,
  },
  disabled: {
    opacity: 0.5,
  },
});
