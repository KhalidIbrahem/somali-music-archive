/**
 * Login screen (ARCHITECTURE.md §12 AUTH, §11 Security).
 *
 * Uses the SAME Zod schema as the API (@sma/validators) so bad input is rejected
 * before any request. Supports biometric unlock of a stored session (Face ID /
 * Touch ID), a show/hide password toggle, and clear, non-sensitive error messages
 * for the failure cases: invalid credentials, unverified email, and rate limiting.
 */

import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Link, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@sma/validators';
import { Screen, Text, Input, Button } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { ApiRequestError } from '@/services/api/unwrap';
import { colors, spacing } from '@/theme';

/** Map an auth failure to a clear, non-sensitive message (never leak specifics). */
function messageForError(err: unknown): string {
  if (err instanceof ApiRequestError) {
    switch (err.code) {
      case 'AUTH_INVALID_CREDENTIALS':
        return 'The email or password you entered is incorrect.';
      case 'AUTH_EMAIL_NOT_VERIFIED':
        return 'Please verify your email before signing in — check your inbox.';
      case 'RATE_LIMITED':
        return 'Too many attempts. Please wait a few minutes and try again.';
      default:
        return 'Something went wrong. Please try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}

export default function Login(): React.JSX.Element {
  const { login, loginWithBiometrics, checkBiometricAvailability } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [biometric, setBiometric] = useState<{ available: boolean; label: string }>({
    available: false,
    label: 'Biometrics',
  });

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  useEffect(() => {
    let active = true;
    void checkBiometricAvailability().then((status) => {
      if (active) setBiometric(status);
    });
    return () => {
      active = false;
    };
  }, [checkBiometricAvailability]);

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await login(values);
      router.replace('/(tabs)/discover');
    } catch (err) {
      setSubmitError(messageForError(err));
    }
  });

  const onBiometric = async (): Promise<void> => {
    setSubmitError(null);
    const result = await loginWithBiometrics();
    if (result.success) {
      router.replace('/(tabs)/discover');
    } else if (result.error) {
      setSubmitError(result.error);
    }
  };

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
            <Text variant="displayMedium">Welcome back</Text>
            <Text variant="bodyMedium" color="secondary">
              Sign in to continue to the archive.
            </Text>
          </View>

          <View style={styles.form}>
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
                  textContentType="username"
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
                  autoComplete="current-password"
                  textContentType="password"
                  error={errors.password?.message}
                />
              )}
            />

            {submitError ? (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
                <Text variant="bodySmall" color="error" style={styles.flex}>
                  {submitError}
                </Text>
              </View>
            ) : null}

            <Button label="Sign in" onPress={onSubmit} loading={isSubmitting} />

            {biometric.available ? (
              <Button
                label={`Sign in with ${biometric.label}`}
                variant="secondary"
                onPress={onBiometric}
              />
            ) : null}

            <Link href="/(auth)/forgot-password" asChild>
              <Button label="Forgot password?" variant="ghost" />
            </Link>
          </View>

          <View style={styles.footer}>
            <Text variant="bodySmall" color="secondary">
              Don&apos;t have an account?
            </Text>
            <Link href="/(auth)/register" asChild>
              <Text variant="bodySmall" color="accent">
                Create one
              </Text>
            </Link>
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
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bg.secondary,
    borderRadius: spacing.md,
    borderWidth: 1,
    borderColor: colors.error,
    padding: spacing.md,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xl,
  },
});
