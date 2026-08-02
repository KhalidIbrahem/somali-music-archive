/**
 * RecordingPreview — plays back the just-captured local take (SESSION P1-03 state 3).
 * A local expo-audio player over the `file://` URI with play/pause, a progress bar, a
 * duration badge, and a static waveform motif. This is a lightweight preview; the
 * global streaming player (useAudioPlayer) arrives in P1-05.
 */

import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
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
  const player = useAudioPlayer({ uri }, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const loadedUriRef = useRef(uri);

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true });
  }, []);

  // A new take arrived while mounted — swap the source without recreating the player.
  useEffect(() => {
    if (loadedUriRef.current === uri) return;
    loadedUriRef.current = uri;
    player.replace({ uri });
  }, [uri, player]);

  useEffect(() => {
    if (status.didJustFinish) {
      void player.seekTo(0);
    }
  }, [status.didJustFinish, player]);

  const toggle = (): void => {
    if (status.playing) {
      player.pause();
    } else {
      player.play();
    }
  };

  const positionMillis = status.didJustFinish ? 0 : Math.round(status.currentTime * 1000);
  const total = durationMillis || 1;
  const progress = Math.min(1, positionMillis / total);

  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <Pressable
          onPress={toggle}
          style={styles.playButton}
          accessibilityRole="button"
          accessibilityLabel={status.playing ? 'Pause preview' : 'Play preview'}
        >
          <Ionicons
            name={status.playing ? 'pause' : 'play'}
            size={24}
            color={colors.text.inverse}
            style={status.playing ? undefined : styles.playNudge}
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
