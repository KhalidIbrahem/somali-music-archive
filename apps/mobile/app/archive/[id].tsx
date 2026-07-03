/**
 * Recording detail (SESSION P1-05, ARCHITECTURE.md §7 "Individual Recording").
 *
 * Full-screen: title, artist in amber, metadata chips, an audio player (streamed
 * from a short-lived signed URL, §11), the AI transcript + description when ready,
 * similar recordings, and a save toggle. Audio loads lazily on first play.
 */

import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GENRE_LABELS, REGION_LABELS, INSTRUMENT_LABELS } from '@sma/constants';
import type { PublicRecording } from '@sma/types';
import { Screen, Text, Card } from '@/components/ui';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { getRecording, getAudioUrl, listRecordings } from '@/services/api/recordings';
import { getSaved, saveRecording, unsaveRecording } from '@/services/api/users';
import { formatDuration } from '@/utils/formatters';
import { colors, radius, spacing } from '@/theme';

export default function RecordingDetail(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const player = useAudioPlayer();
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const {
    data: recording,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['recording', id],
    queryFn: () => getRecording(id),
    enabled: Boolean(id),
  });

  const savedQuery = useQuery({ queryKey: ['saved'], queryFn: getSaved });
  const toggleSave = useMutation({
    mutationFn: (currentlySaved: boolean) =>
      currentlySaved ? unsaveRecording(id) : saveRecording(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['saved'] }),
  });

  const { data: similar } = useQuery({
    queryKey: ['similar', recording?.genre, id],
    queryFn: () => listRecordings({ genre: recording?.genre, limit: 7 }),
    enabled: Boolean(recording),
  });

  if (isLoading) {
    return (
      <Screen>
        <ActivityIndicator color={colors.amber.primary} style={styles.loader} />
      </Screen>
    );
  }
  if (isError || !recording) {
    return (
      <Screen>
        <Text color="error">Recording not found.</Text>
      </Screen>
    );
  }

  const handlePlay = async (): Promise<void> => {
    setAudioError(null);
    if (!ready) {
      setPreparing(true);
      try {
        const { url } = await getAudioUrl(id);
        await player.load(url);
        setReady(true);
        await player.play();
      } catch {
        setAudioError('Could not load the audio. Please try again.');
      } finally {
        setPreparing(false);
      }
      return;
    }
    await player.togglePlay();
  };

  const progress = player.durationMillis > 0 ? player.positionMillis / player.durationMillis : 0;
  const similarItems = (similar?.data ?? []).filter((r) => r.id !== recording.id).slice(0, 6);
  const isSaved = (savedQuery.data ?? []).some((r) => r.id === recording.id);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text variant="displayLarge">{recording.title.somali}</Text>
        {recording.title.english ? (
          <Text variant="bodyMedium" color="secondary">
            {recording.title.english}
          </Text>
        ) : null}
        <Text variant="bodyLarge" color="accent" style={styles.artist}>
          {recording.artist.name}
        </Text>

        <View style={styles.chips}>
          <Chip label={GENRE_LABELS[recording.genre]} />
          {recording.region ? <Chip label={REGION_LABELS[recording.region]} /> : null}
          {recording.era ? <Chip label={recording.era} /> : null}
          {recording.instruments.map((i) => (
            <Chip key={i} label={INSTRUMENT_LABELS[i]} />
          ))}
        </View>

        {/* Player */}
        <Card style={styles.player}>
          <Pressable
            onPress={handlePlay}
            style={styles.playButton}
            accessibilityRole="button"
            accessibilityLabel={player.isPlaying ? 'Pause' : 'Play'}
          >
            {preparing || player.isLoading ? (
              <ActivityIndicator color={colors.text.inverse} />
            ) : (
              <Ionicons
                name={player.isPlaying ? 'pause' : 'play'}
                size={28}
                color={colors.text.inverse}
                style={player.isPlaying ? undefined : styles.playNudge}
              />
            )}
          </Pressable>
          <View style={styles.playerBody}>
            <View style={styles.track}>
              <View style={[styles.trackFill, { width: `${Math.min(100, progress * 100)}%` }]} />
            </View>
            <View style={styles.times}>
              <Text variant="labelMedium" color="secondary">
                {formatDuration(Math.floor(player.positionMillis / 1000))}
              </Text>
              <Text variant="labelMedium" color="secondary">
                {formatDuration(recording.duration)}
              </Text>
            </View>
          </View>
        </Card>
        {audioError ? (
          <Text variant="bodySmall" color="error">
            {audioError}
          </Text>
        ) : null}

        {/* Save */}
        <Pressable
          onPress={() => toggleSave.mutate(isSaved)}
          disabled={toggleSave.isPending || savedQuery.isLoading}
          style={styles.saveRow}
          accessibilityRole="button"
          accessibilityState={{ selected: isSaved }}
        >
          <Ionicons
            name={isSaved ? 'bookmark' : 'bookmark-outline'}
            size={20}
            color={colors.amber.primary}
          />
          <Text variant="bodyMedium" color="accent">
            {isSaved ? 'Saved' : 'Save'}
          </Text>
        </Pressable>

        {recording.ai.musicDescription ? (
          <Section title="ABOUT THIS RECORDING">
            <Text variant="bodyMedium" style={styles.para}>
              {recording.ai.musicDescription}
            </Text>
          </Section>
        ) : null}

        {recording.ai.transcriptSomali || recording.ai.transcriptEnglish ? (
          <Section title="TRANSCRIPT">
            {recording.ai.transcriptSomali ? (
              <Text variant="bodyMedium" style={styles.para}>
                {recording.ai.transcriptSomali}
              </Text>
            ) : null}
            {recording.ai.transcriptEnglish ? (
              <Text variant="bodySmall" color="secondary" style={styles.para}>
                {recording.ai.transcriptEnglish}
              </Text>
            ) : null}
          </Section>
        ) : null}

        {similarItems.length > 0 ? (
          <Section title="SIMILAR RECORDINGS">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.similarRow}
            >
              {similarItems.map((item: PublicRecording) => (
                <Link key={item.id} href={`/archive/${item.id}`} asChild>
                  <Pressable>
                    <Card style={styles.similarCard}>
                      <Text variant="bodyLarge" numberOfLines={2}>
                        {item.title.somali}
                      </Text>
                      <Text variant="bodySmall" color="accent" numberOfLines={1}>
                        {item.artist.name}
                      </Text>
                    </Card>
                  </Pressable>
                </Link>
              ))}
            </ScrollView>
          </Section>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Chip({ label }: { label: string }): React.JSX.Element {
  return (
    <View style={styles.chip}>
      <Text variant="labelMedium" color="secondary">
        {label}
      </Text>
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text variant="labelLarge" color="secondary">
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  loader: {
    marginTop: spacing.xxxl,
  },
  body: {
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  artist: {
    marginTop: spacing.xs,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  chip: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border.primary,
    backgroundColor: colors.bg.secondary,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  player: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.amber.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playNudge: {
    marginLeft: 3,
  },
  playerBody: {
    flex: 1,
    gap: spacing.sm,
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
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  saveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.base,
  },
  section: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  para: {
    lineHeight: 22,
  },
  similarRow: {
    gap: spacing.md,
    paddingRight: spacing.base,
  },
  similarCard: {
    width: 160,
    gap: spacing.xs,
  },
});
