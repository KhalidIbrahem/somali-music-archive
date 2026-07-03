/**
 * RecordingPreview — plays back the just-captured local take (SESSION P1-03 state 3).
 * A local expo-av player over the `file://` URI with play/pause, a progress bar, a
 * duration badge, and a static waveform motif. This is a lightweight preview; the
 * global streaming player (useAudioPlayer) arrives in P1-05.
 */

import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { Card, Text } from '@/components/ui';
import { formatDuration } from '@/utils/formatters';
import { colors, radius, spacing } from '@/theme';

const WAVE = Array.from({ length: 40 }, (_, i) => 0.25 + Math.abs(Math.sin(i * 0.9)) * 0.75);

export interface RecordingPreviewProps {
  uri: string;
  durationMillis: number;
}

export function RecordingPreview({
  uri,
  durationMillis,
}: RecordingPreviewProps): React.JSX.Element {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMillis, setPositionMillis] = useState(0);

  useEffect(() => {
    let mounted = true;
    void Audio.setAudioModeAsync({ playsInSilentModeIOS: true });

    const onStatus = (status: AVPlaybackStatus): void => {
      if (!mounted || !status.isLoaded) return;
      setPositionMillis(status.positionMillis);
      setIsPlaying(status.isPlaying);
      if (status.didJustFinish) {
        setIsPlaying(false);
        setPositionMillis(0);
        void soundRef.current?.setPositionAsync(0);
      }
    };

    void Audio.Sound.createAsync({ uri }, { progressUpdateIntervalMillis: 100 }, onStatus).then(
      ({ sound }) => {
        if (mounted) {
          soundRef.current = sound;
        } else {
          void sound.unloadAsync();
        }
      },
    );

    return () => {
      mounted = false;
      void soundRef.current?.unloadAsync();
      soundRef.current = null;
    };
  }, [uri]);

  const toggle = async (): Promise<void> => {
    const sound = soundRef.current;
    if (!sound) return;
    if (isPlaying) {
      await sound.pauseAsync();
    } else {
      await sound.playAsync();
    }
  };

  const total = durationMillis || 1;
  const progress = Math.min(1, positionMillis / total);

  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <Pressable
          onPress={toggle}
          style={styles.playButton}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pause preview' : 'Play preview'}
        >
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={24}
            color={colors.text.inverse}
            style={isPlaying ? undefined : styles.playNudge}
          />
        </Pressable>

        <View style={styles.waveform}>
          {WAVE.map((h, i) => {
            const played = i / WAVE.length <= progress;
            return (
              <View
                key={i}
                style={[
                  styles.waveBar,
                  {
                    height: `${h * 100}%`,
                    backgroundColor: played ? colors.amber.primary : colors.border.primary,
                  },
                ]}
              />
            );
          })}
        </View>

        <View style={styles.badge}>
          <Text variant="labelMedium" color="secondary">
            {formatDuration(Math.round(durationMillis / 1000))}
          </Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  playButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.amber.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playNudge: {
    marginLeft: 3, // optically centre the play triangle
  },
  waveform: {
    flex: 1,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  waveBar: {
    flex: 1,
    minHeight: 3,
    borderRadius: 999,
  },
  badge: {
    borderRadius: radius.sm,
    backgroundColor: colors.bg.tertiary,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
});
