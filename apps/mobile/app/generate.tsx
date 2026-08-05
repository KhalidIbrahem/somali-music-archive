/**
 * Generation Studio (pushed route, like /subscription).
 *
 * Describe → pick a model → generate → poll → play. Talks to the Node API's
 * provider-agnostic endpoint via useGeneration; playback stages data: URIs to
 * a cache file first (expo-audio wants file/https sources). Generated pieces
 * are experiments — deliberately separate from the preservation archive.
 */

import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import type { MusicProvider } from '@sma/types';
import { Screen, Text, Card, Button, Input, Chips } from '@/components/ui';
import { useGeneration } from '@/hooks/useGeneration';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { resolvePlayableUri } from '@/services/audio/dataUri';
import { ApiRequestError } from '@/services/api/unwrap';
import { brandMessage, brandProviderName, MODEL_TIERS } from '@/utils/brand';
import { colors, radius, spacing } from '@/theme';

const PROVIDER_OPTIONS = MODEL_TIERS;

const INSTRUMENTAL_CHIP = 'instrumental';

export default function GenerateStudio(): React.JSX.Element {
  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState<MusicProvider>('lyria');
  const [instrumental, setInstrumental] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);

  const { start, job, isWorking, reset } = useGeneration();
  const player = useAudioPlayer();

  const submit = useCallback(() => {
    if (isWorking || prompt.trim().length < 3) return;
    setPlayError(null);
    start.mutate({ provider, prompt: prompt.trim(), instrumental });
  }, [isWorking, prompt, provider, instrumental, start]);

  const handlePlay = useCallback(async () => {
    if (!job?.track) return;
    setPlayError(null);
    try {
      if (player.isPlaying) {
        await player.pause();
        return;
      }
      if (player.durationMillis === 0) {
        // First play: resolve (data: → cache file) and load.
        const uri = await resolvePlayableUri(job.track.audioUrl);
        await player.load(uri);
      }
      await player.play();
    } catch {
      setPlayError('Could not play the track — try generating again.');
    }
  }, [job, player]);

  const submitErrorMessage =
    start.error instanceof ApiRequestError
      ? start.error.code === 'RATE_LIMITED'
        ? 'You have reached the hourly generation limit — try again a little later.'
        : brandMessage(start.error.message)
      : start.error
        ? 'Generation failed — check your connection and try again.'
        : null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text variant="displayLarge">Generation Studio</Text>
        <Text variant="bodyMedium" color="secondary">
          Describe a song and let AI compose in the spirit of the tradition. Generated pieces are
          experiments, kept apart from the field recordings.
        </Text>

        <Card style={styles.formCard}>
          <Input
            label="Describe the music"
            value={prompt}
            onChangeText={setPrompt}
            placeholder="e.g. A gentle qaraami love song with solo oud…"
            multiline
            numberOfLines={3}
            maxLength={500}
            style={styles.promptInput}
          />

          {/* Single-select over the multi-select Chips: an empty toggle keeps
              the current provider, a new pick replaces it. */}
          <Chips
            label="Model"
            options={PROVIDER_OPTIONS}
            value={[provider]}
            onChange={(vals) => {
              const next = vals.find((v) => v !== provider);
              if (next) setProvider(next as MusicProvider);
            }}
          />
          <Text variant="bodySmall" color="tertiary">
            {PROVIDER_OPTIONS.find((p) => p.value === provider)?.note}
          </Text>

          <Chips
            label="Options"
            options={[{ label: 'Instrumental only', value: INSTRUMENTAL_CHIP }]}
            value={instrumental ? [INSTRUMENTAL_CHIP] : []}
            onChange={(vals) => setInstrumental(vals.includes(INSTRUMENTAL_CHIP))}
          />

          <Button
            label={isWorking ? 'Generating…' : 'Generate'}
            onPress={submit}
            loading={isWorking}
            disabled={prompt.trim().length < 3}
          />
          {submitErrorMessage ? (
            <Text variant="bodySmall" color="error">
              {submitErrorMessage}
            </Text>
          ) : null}
        </Card>

        {job && (job.state === 'queued' || job.state === 'running') ? (
          <Card style={styles.statusCard}>
            <ActivityIndicator color={colors.amber.primary} />
            <View style={styles.statusText}>
              <Text variant="bodyLarge">{job.state === 'queued' ? 'Queued…' : 'Composing…'}</Text>
              <Text variant="bodySmall" color="secondary">
                This can take a minute or two — the app checks every few seconds.
              </Text>
            </View>
          </Card>
        ) : null}

        {job?.state === 'failed' ? (
          <Card style={styles.resultCard}>
            <Text variant="bodyLarge" color="error">
              Generation failed
            </Text>
            <Text variant="bodySmall" color="secondary">
              {brandMessage(job.error ?? 'Unknown error')}
            </Text>
            <Button label="Start over" variant="ghost" onPress={reset} />
          </Card>
        ) : null}

        {job?.state === 'succeeded' && job.track ? (
          <Card style={styles.resultCard}>
            <View style={styles.resultHeader}>
              <Text variant="displaySmall" style={styles.flex} numberOfLines={2}>
                {job.track.title ?? 'Generated track'}
              </Text>
              <View style={styles.badge}>
                <Text variant="labelSmall" color="inverse">
                  AI · {brandProviderName(job.provider)}
                </Text>
              </View>
            </View>
            <Button
              label={player.isPlaying ? 'Pause' : player.isLoading ? 'Loading…' : 'Play'}
              onPress={() => void handlePlay()}
              loading={player.isLoading}
            />
            {playError ? (
              <Text variant="bodySmall" color="error">
                {playError}
              </Text>
            ) : null}
            {job.track.lyrics ? (
              <View style={styles.lyrics}>
                <Text variant="labelLarge" color="secondary">
                  Lyrics / structure
                </Text>
                <Text variant="bodySmall" color="secondary">
                  {job.track.lyrics}
                </Text>
              </View>
            ) : null}
            <Button label="Generate another" variant="ghost" onPress={reset} />
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.base,
    paddingVertical: spacing.lg,
  },
  formCard: {
    gap: spacing.base,
  },
  promptInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
  },
  statusText: {
    flex: 1,
    gap: spacing.xs,
  },
  resultCard: {
    gap: spacing.base,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  badge: {
    borderRadius: radius.sm,
    backgroundColor: colors.amber.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  lyrics: {
    gap: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.primary,
    padding: spacing.md,
  },
});
