/**
 * LessonBlockView — renders one lesson content block (ARCHITECTURE.md §7):
 *   • text          → paragraphs,
 *   • audio         → an embedded player for an archive recording,
 *   • pitch-exercise→ the interactive "sing the note" meter.
 */

import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { LessonBlock } from '@sma/types';
import { Card, Text, Button } from '@/components/ui';
import { PitchMeter } from '@/components/audio/PitchMeter';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { usePitchExercise } from '@/hooks/usePitchExercise';
import { getAudioUrl } from '@/services/api/recordings';
import { formatDuration } from '@/utils/formatters';
import { colors, radius, spacing } from '@/theme';

export function LessonBlockView({ block }: { block: LessonBlock }): React.JSX.Element {
  switch (block.kind) {
    case 'text':
      return <TextBlock markdown={block.markdown} />;
    case 'audio':
      return <AudioBlock recordingId={block.recordingId} caption={block.caption} />;
    case 'pitch-exercise':
      return <PitchExerciseBlock targetNote={block.targetNote} targetHz={block.targetHz} />;
  }
}

function TextBlock({ markdown }: { markdown: string }): React.JSX.Element {
  const paragraphs = markdown.split('\n\n').filter((p) => p.trim().length > 0);
  return (
    <View style={styles.textBlock}>
      {paragraphs.map((p, i) => (
        <Text key={i} variant="bodyMedium" style={styles.paragraph}>
          {p.trim()}
        </Text>
      ))}
    </View>
  );
}

function AudioBlock({
  recordingId,
  caption,
}: {
  recordingId: string;
  caption?: string | undefined;
}): React.JSX.Element {
  const player = useAudioPlayer();
  const [ready, setReady] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState(false);

  const handlePlay = async (): Promise<void> => {
    if (!ready) {
      setPreparing(true);
      setError(false);
      try {
        const { url } = await getAudioUrl(recordingId);
        await player.load(url);
        setReady(true);
        await player.play();
      } catch {
        setError(true);
      } finally {
        setPreparing(false);
      }
      return;
    }
    await player.togglePlay();
  };

  const progress = player.durationMillis > 0 ? player.positionMillis / player.durationMillis : 0;

  return (
    <Card style={styles.audioCard}>
      <View style={styles.audioRow}>
        <Pressable
          onPress={handlePlay}
          style={styles.playButton}
          accessibilityRole="button"
          accessibilityLabel={player.isPlaying ? 'Pause example' : 'Play example'}
        >
          {preparing || player.isLoading ? (
            <ActivityIndicator color={colors.text.inverse} />
          ) : (
            <Ionicons
              name={player.isPlaying ? 'pause' : 'play'}
              size={22}
              color={colors.text.inverse}
              style={player.isPlaying ? undefined : styles.playNudge}
            />
          )}
        </Pressable>
        <View style={styles.audioBody}>
          <View style={styles.track}>
            <View style={[styles.trackFill, { width: `${Math.min(100, progress * 100)}%` }]} />
          </View>
          <Text variant="labelMedium" color="secondary">
            {formatDuration(Math.floor(player.positionMillis / 1000))}
          </Text>
        </View>
      </View>
      {caption ? (
        <Text variant="bodySmall" color="secondary">
          {caption}
        </Text>
      ) : null}
      {error ? (
        <Text variant="bodySmall" color="error">
          Could not load this example.
        </Text>
      ) : null}
    </Card>
  );
}

function PitchExerciseBlock({
  targetNote,
  targetHz,
}: {
  targetNote: string;
  targetHz: number;
}): React.JSX.Element {
  const exercise = usePitchExercise(targetHz);

  return (
    <Card style={styles.exerciseCard}>
      <View style={styles.exerciseHeader}>
        <Text variant="labelLarge" color="secondary">
          PITCH EXERCISE
        </Text>
        <Text variant="displaySmall" color="accent">
          {targetNote.toUpperCase()} · {Math.round(targetHz)} Hz
        </Text>
      </View>

      <PitchMeter result={exercise.attempt?.accuracy ?? null} />

      {exercise.isListening ? (
        <View style={styles.levelWrap}>
          <View style={styles.levelTrack}>
            <View style={[styles.levelFill, { width: `${exercise.level * 100}%` }]} />
          </View>
          <Button
            label="Stop & score"
            variant="secondary"
            onPress={() => void exercise.stopAndScore()}
          />
        </View>
      ) : exercise.analyzing ? (
        <ActivityIndicator color={colors.amber.primary} />
      ) : exercise.attempt ? (
        <Button label="Try again" variant="ghost" onPress={exercise.reset} />
      ) : (
        <Button label="Sing the note" onPress={() => void exercise.start()} />
      )}

      {exercise.error ? (
        <Text variant="bodySmall" color="error">
          {exercise.error}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  textBlock: {
    gap: spacing.md,
  },
  paragraph: {
    lineHeight: 24,
  },
  audioCard: {
    gap: spacing.sm,
  },
  audioRow: {
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
    marginLeft: 3,
  },
  audioBody: {
    flex: 1,
    gap: spacing.xs,
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border.primary,
    overflow: 'hidden',
  },
  trackFill: {
    height: 4,
    backgroundColor: colors.amber.primary,
  },
  exerciseCard: {
    gap: spacing.base,
  },
  exerciseHeader: {
    gap: spacing.xs,
  },
  levelWrap: {
    gap: spacing.sm,
  },
  levelTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.border.primary,
    overflow: 'hidden',
  },
  levelFill: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.error,
  },
});
