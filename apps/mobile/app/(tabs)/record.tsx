/**
 * Record screen (SESSION P1-03, ARCHITECTURE.md §7 "Record").
 *
 * The field-recording tool Khalid uses at Ahmed Ali Egal's home. Role-gated to
 * contributor/admin (§11 — enforced here, not just hidden in the tab bar). Three
 * states: READY → RECORDING → REVIEW (playback + metadata form → upload).
 *
 * Audio is captured locally as WAV and uploaded DIRECTLY to R2 via a presigned URL
 * (CONVENTIONS.md hard rule — never through our API). Metadata is validated with Zod.
 */

import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { genreSchema, regionSchema, instrumentSchema } from '@sma/validators';
import type { Instrument } from '@sma/constants';
import { Screen, Text, Card, Button, Input, Select, Chips } from '@/components/ui';
import { RecordButton } from '@/components/audio/RecordButton';
import { WaveformMeter } from '@/components/audio/WaveformMeter';
import { RecordingPreview } from '@/components/audio/RecordingPreview';
import { useAuthStore } from '@/stores/authStore';
import { useAudioRecorder, LONG_RECORDING_WARNING_MS } from '@/hooks/useAudioRecorder';
import {
  getUploadUrl,
  uploadToR2,
  notifyComplete,
  contentTypeForUri,
  type RecordingMetadata,
} from '@/services/api/recordings';
import { ApiRequestError } from '@/services/api/unwrap';
import {
  GENRE_OPTIONS,
  REGION_OPTIONS,
  INSTRUMENT_OPTIONS,
  OCCASION_OPTIONS,
} from '@/constants/recordingOptions';
import { formatDuration } from '@/utils/formatters';
import { colors, spacing } from '@/theme';

const DEFAULT_SINGER = 'Ahmed Ali Egal';

/** UI form schema — captures exactly the record screen's fields (RHF + Zod). */
const recordingFormSchema = z.object({
  titleSomali: z.string().trim().min(1, 'Song title is required'),
  singerName: z.string().trim().min(1, 'Singer name is required'),
  poetName: z.string().trim().optional(),
  genre: genreSchema,
  occasion: z.string().optional(),
  region: regionSchema.optional(),
  era: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^\d{4}s$/.test(v), 'Use a decade like "1970s"'),
  instruments: z.array(instrumentSchema).min(1, 'Select at least one instrument'),
  fieldNotes: z.string().trim().optional(),
});

type RecordingFormValues = z.infer<typeof recordingFormSchema>;

export default function Record(): React.JSX.Element {
  const role = useAuthStore((s) => s.user?.role ?? 'listener');
  const recorder = useAudioRecorder();
  const [startError, setStartError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);

  const sessionId = useMemo(() => `session-${Date.now()}`, []);
  const today = useMemo(() => new Date().toLocaleDateString(), []);

  const {
    control,
    handleSubmit,
    reset: resetForm,
    formState: { errors },
  } = useForm<RecordingFormValues>({
    resolver: zodResolver(recordingFormSchema),
    defaultValues: {
      titleSomali: '',
      singerName: DEFAULT_SINGER,
      poetName: '',
      occasion: '',
      era: '',
      instruments: ['voice'] as Instrument[],
      fieldNotes: '',
    },
  });

  // Contributor/admin only — the security boundary, not just a hidden tab.
  if (role !== 'contributor' && role !== 'admin') {
    return <Redirect href="/(tabs)/discover" />;
  }

  const onRecordPress = async (): Promise<void> => {
    setStartError(null);
    if (recorder.status === 'recording') {
      await recorder.stop();
      return;
    }
    try {
      await recorder.start();
    } catch {
      setStartError('Microphone access is needed to record. Enable it in Settings.');
    }
  };

  const reRecord = (): void => {
    recorder.reset();
    setUploadError(null);
    setSaved(false);
  };

  const onSubmit = handleSubmit(async (values) => {
    if (!recorder.uri) return;
    setUploadError(null);
    setUploading(true);
    try {
      const contentType = contentTypeForUri(recorder.uri);
      const filename = recorder.uri.split('/').pop() ?? `recording-${Date.now()}.wav`;
      const presigned = await getUploadUrl({ filename, contentType, sessionId });
      await uploadToR2(presigned.uploadUrl, recorder.uri, contentType);

      const metadata: RecordingMetadata = {
        title: { somali: values.titleSomali },
        singerName: values.singerName,
        genre: values.genre,
        instruments: values.instruments,
        ...(values.poetName ? { poetName: values.poetName } : {}),
        ...(values.occasion ? { occasion: values.occasion } : {}),
        ...(values.region ? { region: values.region } : {}),
        ...(values.era ? { era: values.era } : {}),
        ...(values.fieldNotes ? { fieldNotes: values.fieldNotes } : {}),
      };
      await notifyComplete(presigned.recordingId, presigned.fileKey, metadata);

      setSaved(true);
      resetForm({ ...values, titleSomali: '' });
    } catch (err) {
      setUploadError(
        err instanceof ApiRequestError
          ? err.message
          : 'Upload failed. Check your connection and try again.',
      );
    } finally {
      setUploading(false);
    }
  });

  // ── Saved confirmation ──────────────────────────────────────────────────────
  if (saved) {
    return (
      <Screen>
        <View style={styles.centered}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={40} color={colors.text.inverse} />
          </View>
          <Text variant="displaySmall" style={styles.center}>
            Saved to the archive
          </Text>
          <Text variant="bodyMedium" color="secondary" style={styles.center}>
            The recording is uploading and will be processed shortly. Ahmed&apos;s legacy is
            preserved.
          </Text>
          <Button label="Record another" onPress={reRecord} />
        </View>
      </Screen>
    );
  }

  const isRecording = recorder.status === 'recording';
  const isReview = recorder.status === 'stopped' && recorder.uri !== null;
  const overWarning = recorder.durationMillis >= LONG_RECORDING_WARNING_MS;

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text variant="displayLarge" style={styles.title}>
            Record
          </Text>

          {/* Session header */}
          <Card style={styles.sessionCard}>
            <View style={styles.sessionRow}>
              <Text variant="labelLarge" color="secondary">
                ARTIST
              </Text>
              <Text variant="bodyLarge">{DEFAULT_SINGER}</Text>
            </View>
            <View style={styles.sessionRow}>
              <Text variant="labelLarge" color="secondary">
                DATE
              </Text>
              <Text variant="bodyMedium" color="secondary">
                {today}
              </Text>
            </View>
          </Card>

          {!isReview ? (
            // ── STATES 1 & 2 — ready / recording ────────────────────────────
            <View style={styles.recorder}>
              {isRecording ? (
                <WaveformMeter level={recorder.meterLevel} />
              ) : (
                <Text variant="bodyMedium" color="secondary" style={styles.center}>
                  Each recording is one song. Press to begin.
                </Text>
              )}

              <RecordButton isRecording={isRecording} onPress={onRecordPress} />

              <Text variant="displayMedium" color={isRecording ? 'error' : 'secondary'}>
                {formatDuration(Math.floor(recorder.durationMillis / 1000))}
              </Text>

              {isRecording && overWarning ? (
                <Text variant="bodySmall" color="warning" style={styles.center}>
                  This take is over 15 minutes. Consider splitting long sessions per song.
                </Text>
              ) : null}

              {startError ? (
                <View style={styles.errorRow}>
                  <Text variant="bodySmall" color="error" style={styles.center}>
                    {startError}
                  </Text>
                  <Button
                    label="Open Settings"
                    variant="ghost"
                    onPress={() => void Linking.openSettings()}
                  />
                </View>
              ) : null}
            </View>
          ) : (
            // ── STATE 3 — review + metadata ─────────────────────────────────
            <View style={styles.form}>
              {recorder.uri ? (
                <RecordingPreview uri={recorder.uri} durationMillis={recorder.durationMillis} />
              ) : null}

              <Controller
                control={control}
                name="titleSomali"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    label="Song title (Somali)"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.titleSomali?.message}
                  />
                )}
              />
              <Controller
                control={control}
                name="singerName"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    label="Singer"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.singerName?.message}
                  />
                )}
              />
              <Controller
                control={control}
                name="poetName"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    label="Original poet (optional)"
                    value={value ?? ''}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.poetName?.message}
                  />
                )}
              />
              <Controller
                control={control}
                name="genre"
                render={({ field: { onChange, value } }) => (
                  <Select
                    label="Genre"
                    value={value}
                    options={GENRE_OPTIONS}
                    onChange={onChange}
                    placeholder="Choose a genre"
                    error={errors.genre?.message}
                  />
                )}
              />
              <Controller
                control={control}
                name="occasion"
                render={({ field: { onChange, value } }) => (
                  <Select
                    label="Occasion (optional)"
                    value={value}
                    options={OCCASION_OPTIONS}
                    onChange={onChange}
                    placeholder="Choose an occasion"
                    error={errors.occasion?.message}
                  />
                )}
              />
              <Controller
                control={control}
                name="region"
                render={({ field: { onChange, value } }) => (
                  <Select
                    label="Region of origin (optional)"
                    value={value}
                    options={REGION_OPTIONS}
                    onChange={onChange}
                    placeholder="Choose a region"
                    error={errors.region?.message}
                  />
                )}
              />
              <Controller
                control={control}
                name="era"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    label="Era (optional)"
                    placeholder="e.g. 1970s"
                    value={value ?? ''}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    autoCapitalize="none"
                    error={errors.era?.message}
                  />
                )}
              />
              <Controller
                control={control}
                name="instruments"
                render={({ field: { onChange, value } }) => (
                  <Chips
                    label="Instruments"
                    options={INSTRUMENT_OPTIONS}
                    value={value}
                    onChange={onChange}
                    error={errors.instruments?.message}
                  />
                )}
              />
              <Controller
                control={control}
                name="fieldNotes"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    label="Field notes (optional)"
                    value={value ?? ''}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    multiline
                    numberOfLines={4}
                    style={styles.notes}
                    error={errors.fieldNotes?.message}
                  />
                )}
              />

              {uploadError ? (
                <Text variant="bodySmall" color="error">
                  {uploadError}
                </Text>
              ) : null}

              <Button label="Save to archive" onPress={onSubmit} loading={uploading} />
              <Button label="Re-record" variant="ghost" onPress={reRecord} disabled={uploading} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.xxl,
  },
  title: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.base,
  },
  center: {
    textAlign: 'center',
  },
  sessionCard: {
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  sessionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  recorder: {
    alignItems: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  errorRow: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  form: {
    gap: spacing.base,
  },
  notes: {
    minHeight: 96,
    paddingTop: spacing.md,
    textAlignVertical: 'top',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.base,
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
