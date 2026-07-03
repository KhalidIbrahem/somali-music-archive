/**
 * Registration screen (ARCHITECTURE.md §12 AUTH, §11 Compliance).
 *
 * Extends the shared `registerSchema` (@sma/validators) with a client-only
 * `confirmPassword` check. The date-of-birth field feeds the schema's COPPA age
 * gate (13+) and the terms checkbox its acceptance requirement — the same rules
 * the API enforces server-side. A language preference (Somali / Arabic / English)
 * is captured up front; Somali is the default (Principle 1).
 */

import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { registerSchema } from '@sma/validators';
import { UI_LANGUAGES, LANGUAGE_DESCRIPTORS } from '@sma/constants';
import { Screen, Text, Input, Button } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { ApiRequestError } from '@/services/api/unwrap';
import { colors, radius, spacing } from '@/theme';

const TERMS_URL = 'https://somalimusicarchive.com/terms';
const PRIVACY_URL = 'https://somalimusicarchive.com/privacy';

/** The API schema plus a client-only confirm-password field. */
const registerFormSchema = registerSchema
  .extend({ confirmPassword: z.string().min(1, 'Please confirm your password') })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type RegisterFormValues = z.infer<typeof registerFormSchema>;

export default function Register(): React.JSX.Element {
  const { register } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      displayName: '',
      email: '',
      password: '',
      confirmPassword: '',
      dateOfBirth: '',
      language: 'so',
      acceptedTerms: true,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    // Build the API payload explicitly — `confirmPassword` is client-only and is
    // intentionally not sent to the server.
    try {
      await register({
        email: values.email,
        password: values.password,
        displayName: values.displayName,
        dateOfBirth: values.dateOfBirth,
        language: values.language,
        acceptedTerms: values.acceptedTerms,
      });
      router.replace('/(tabs)/discover');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === 'AUTH_EMAIL_TAKEN') {
          setError('email', { message: 'An account with this email already exists.' });
          return;
        }
        // Map server field validation errors back onto the form.
        if (err.code === 'VALIDATION_ERROR' && err.fields) {
          for (const field of err.fields) {
            if (field.path in values) {
              setError(field.path as keyof RegisterFormValues, { message: field.message });
            }
          }
          return;
        }
      }
      setSubmitError('Something went wrong. Please try again.');
    }
  });

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
          <View style={styles.header}>
            <Text variant="displayMedium">Create account</Text>
            <Text variant="bodyMedium" color="secondary">
              Join families connecting through Somali music.
            </Text>
          </View>

          <View style={styles.form}>
            <Controller
              control={control}
              name="displayName"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Name"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  autoComplete="name"
                  textContentType="name"
                  error={errors.displayName?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Email"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  textContentType="emailAddress"
                  error={errors.email?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Password"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  showPasswordToggle
                  autoComplete="new-password"
                  textContentType="newPassword"
                  error={errors.password?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="confirmPassword"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Confirm password"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  showPasswordToggle
                  autoComplete="new-password"
                  error={errors.confirmPassword?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="dateOfBirth"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Date of birth"
                  placeholder="YYYY-MM-DD"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  autoCapitalize="none"
                  keyboardType="numbers-and-punctuation"
                  error={errors.dateOfBirth?.message}
                />
              )}
            />

            {/* Language preference */}
            <Controller
              control={control}
              name="language"
              render={({ field: { value, onChange } }) => (
                <View style={styles.group}>
                  <Text variant="labelLarge" color="secondary">
                    Language
                  </Text>
                  <View style={styles.langRow}>
                    {UI_LANGUAGES.map((code) => {
                      const active = value === code;
                      return (
                        <Pressable
                          key={code}
                          onPress={() => onChange(code)}
                          style={[styles.langChip, active ? styles.langChipActive : null]}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: active }}
                          accessibilityLabel={LANGUAGE_DESCRIPTORS[code]?.englishName ?? code}
                        >
                          <Text variant="bodyMedium" color={active ? 'inverse' : 'primary'}>
                            {LANGUAGE_DESCRIPTORS[code]?.nativeName ?? code}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}
            />

            {/* Terms of service */}
            <Controller
              control={control}
              name="acceptedTerms"
              render={({ field: { value, onChange } }) => (
                <Pressable
                  style={styles.terms}
                  onPress={() => onChange(!value)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: value }}
                >
                  <View style={[styles.checkbox, value ? styles.checkboxOn : null]}>
                    {value ? <Text style={styles.checkmark}>✓</Text> : null}
                  </View>
                  <Text variant="bodySmall" color="secondary" style={styles.flex}>
                    I accept the{' '}
                    <Text
                      variant="bodySmall"
                      color="accent"
                      onPress={() => void Linking.openURL(TERMS_URL)}
                    >
                      Terms of Service
                    </Text>{' '}
                    and{' '}
                    <Text
                      variant="bodySmall"
                      color="accent"
                      onPress={() => void Linking.openURL(PRIVACY_URL)}
                    >
                      Privacy Policy
                    </Text>
                    .
                  </Text>
                </Pressable>
              )}
            />
            {errors.acceptedTerms ? (
              <Text variant="bodySmall" color="error">
                {errors.acceptedTerms.message}
              </Text>
            ) : null}

            {submitError ? (
              <Text variant="bodySmall" color="error">
                {submitError}
              </Text>
            ) : null}

            <Button label="Create account" onPress={onSubmit} loading={isSubmitting} />
          </View>

          <View style={styles.footer}>
            <Text variant="bodySmall" color="secondary">
              Already have an account?
            </Text>
            <Text
              variant="bodySmall"
              color="accent"
              onPress={() => router.replace('/(auth)/login')}
            >
              Sign in
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.xl,
  },
  header: {
    gap: spacing.xs,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
  },
  form: {
    gap: spacing.base,
  },
  group: {
    gap: spacing.xs,
  },
  langRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  langChip: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.primary,
    backgroundColor: colors.bg.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  langChipActive: {
    backgroundColor: colors.amber.primary,
    borderColor: colors.amber.primary,
  },
  terms: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border.primary,
    backgroundColor: colors.bg.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: colors.amber.primary,
    borderColor: colors.amber.primary,
  },
  checkmark: {
    color: colors.text.inverse,
    fontSize: 14,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xl,
  },
});
