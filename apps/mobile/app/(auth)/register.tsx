/**
 * Registration screen (ARCHITECTURE.md §12 AUTH, §11 Compliance).
 *
 * Reuses `registerSchema` from @sma/validators, which enforces the COPPA age gate
 * (13+) and requires explicit terms acceptance — the exact same rules the API
 * applies server-side.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterInput } from '@sma/validators';
import { Screen, Text, Input, Button } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { ApiRequestError } from '@/services/api/unwrap';
import { colors, radius, spacing } from '@/theme';

export default function Register(): React.JSX.Element {
  const registerUser = useAuthStore((s) => s.register);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      password: '',
      displayName: '',
      dateOfBirth: '',
      acceptedTerms: true,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await registerUser(values);
      router.replace('/(tabs)/discover');
    } catch (err) {
      setSubmitError(
        err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.',
      );
    }
  });

  return (
    <Screen>
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
              secureTextEntry
              autoComplete="new-password"
              error={errors.password?.message}
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
              error={errors.dateOfBirth?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="acceptedTerms"
          render={({ field: { onChange, value } }) => (
            <Pressable
              style={styles.terms}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: value }}
              onPress={() => onChange(!value)}
            >
              <View style={[styles.checkbox, value ? styles.checkboxOn : null]} />
              <Text variant="bodySmall" color="secondary" style={styles.termsLabel}>
                I accept the terms of service and privacy policy.
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.xs,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
  },
  form: {
    gap: spacing.base,
  },
  terms: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border.primary,
    backgroundColor: colors.bg.secondary,
  },
  checkboxOn: {
    backgroundColor: colors.amber.primary,
    borderColor: colors.amber.primary,
  },
  termsLabel: {
    flex: 1,
  },
});
