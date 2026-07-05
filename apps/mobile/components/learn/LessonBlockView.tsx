/**
 * LessonBlockView — renders one lesson content block (ARCHITECTURE.md §7):
 *   • text          → paragraphs,
 *   • audio         → an embedded player for an archive recording,
 *   • pitch-exercise→ the interactive "sing the note" meter.
 */

import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CalloutTone, LessonBlock } from '@sma/types';
import { Card, Text, Button } from '@/components/ui';
import { PitchMeter } from '@/components/audio/PitchMeter';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { usePitchExercise } from '@/hooks/usePitchExercise';
import { getAudioUrl } from '@/services/api/recordings';
import { formatDuration } from '@/utils/formatters';
import { quizOptionState } from '@/utils/lessons';
import { colors, radius, spacing } from '@/theme';

export function LessonBlockView({ block }: { block: LessonBlock }): React.JSX.Element {
  switch (block.kind) {
    case 'text':
      return <TextBlock markdown={block.markdown} />;
    case 'heading':
      return <HeadingBlock text={block.text} />;
    case 'callout':
      return <CalloutBlock tone={block.tone} body={block.body} />;
    case 'audio':
      return <AudioBlock recordingId={block.recordingId} caption={block.caption} />;
    case 'pitch-exercise':
      return <PitchExerciseBlock targetNote={block.targetNote} targetHz={block.targetHz} />;
    case 'quiz':
      return <QuizBlock block={block} />;
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

function HeadingBlock({ text }: { text: string }): React.JSX.Element {
  return (
    <Text variant="displaySmall" style={styles.heading}>
      {text}
    </Text>
  );
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const CALLOUT: Record<CalloutTone, { label: string; color: string; icon: IconName }> = {
  note: { label: 'NOTE', color: colors.info, icon: 'information-circle-outline' },
  tip: { label: 'TIP', color: colors.amber.primary, icon: 'bulb-outline' },
  warning: { label: 'IMPORTANT', color: colors.warning, icon: 'alert-circle-outline' },
};

function CalloutBlock({ tone, body }: { tone: CalloutTone; body: string }): React.JSX.Element {
  const style = CALLOUT[tone];
  return (
    <View style={[styles.callout, { borderLeftColor: style.color }]}>
      <View style={styles.calloutHeader}>
        <Ionicons name={style.icon} size={16} color={style.color} />
        <Text variant="labelMedium" style={{ color: style.color }}>
          {style.label}
        </Text>
      </View>
      <Text variant="bodyMedium" style={styles.paragraph}>
        {body}
      </Text>
    </View>
  );
}

type QuizBlockType = Extract<LessonBlock, { kind: 'quiz' }>;

function QuizBlock({ block }: { block: QuizBlockType }): React.JSX.Element {
  const [selected, setSelected] = useState<number | null>(null);
  const answered = selected !== null;

  return (
    <Card style={styles.quizCard}>
      <Text variant="labelLarge" color="secondary">
        QUIZ
      </Text>
      <Text variant="bodyLarge">{block.prompt}</Text>
      <View style={styles.quizOptions}>
        {block.options.map((option, i) => {
          const state = quizOptionState(block, selected, i);
          return (
            <Pressable
              key={i}
              onPress={() => setSelected(i)}
              disabled={answered}
              accessibilityRole="radio"
              accessibilityState={{ selected: selected === i }}
              style={[
                styles.quizOption,
                state === 'correct'
                  ? styles.quizCorrect
                  : state === 'incorrect'
                    ? styles.quizIncorrect
                    : null,
              ]}
            >
              <Text variant="bodyMedium">{option}</Text>
            </Pressable>
          );
        })}
      </View>
      {answered && block.explanation ? (
        <Text variant="bodySmall" color="secondary" style={styles.paragraph}>
          {block.explanation}
        </Text>
      ) : null}
    </Card>
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
  heading: {
    marginTop: spacing.sm,
  },
  callout: {
    borderLeftWidth: 3,
    borderRadius: radius.md,
    backgroundColor: colors.bg.secondary,
    padding: spacing.base,
    gap: spacing.xs,
  },
  calloutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  quizCard: {
    gap: spacing.sm,
  },
  quizOptions: {
    gap: spacing.sm,
  },
  quizOption: {
    borderWidth: 1,
    borderColor: colors.border.primary,
    borderRadius: radius.md,
    backgroundColor: colors.bg.secondary,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  quizCorrect: {
    borderColor: colors.success,
    backgroundColor: 'rgba(90, 184, 138, 0.12)',
  },
  quizIncorrect: {
    borderColor: colors.error,
    backgroundColor: 'rgba(224, 90, 90, 0.12)',
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
