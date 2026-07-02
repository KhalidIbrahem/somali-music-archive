/**
 * Login screen (ARCHITECTURE.md §12 AUTH). Uses the SAME Zod schema the API uses
 * (@sma/validators) so the client rejects bad input before a request is ever made.
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Link, router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@sma/validators';
import { Screen, Text, Input, Button } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { ApiRequestError } from '@/services/api/unwrap';
import { spacing } from '@/theme';

export default function Login(): React.JSX.Element {
  const login = useAuthStore((s) => s.login);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await login(values);
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
              autoComplete="current-password"
              error={errors.password?.message}
            />
          )}
        />

        {submitError ? (
          <Text variant="bodySmall" color="error">
            {submitError}
          </Text>
        ) : null}

        <Button label="Sign in" onPress={onSubmit} loading={isSubmitting} />

        <Link href="/(auth)/forgot-password" asChild>
          <Button label="Forgot password?" variant="ghost" />
        </Link>
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
});
