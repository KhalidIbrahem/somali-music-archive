/**
 * Forgot-password screen (ARCHITECTURE.md §12 AUTH). Sends a reset email; the
 * response is intentionally generic to avoid leaking which emails are registered
 * (§11 — account enumeration is an information leak).
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@sma/validators';
import { Screen, Text, Input, Button } from '@/components/ui';
import { apiClient } from '@/services/api/client';
import { spacing } from '@/theme';

export default function ForgotPassword(): React.JSX.Element {
  const [sent, setSent] = useState(false);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    // Always resolve to the same UI regardless of whether the email exists.
    await apiClient.post('/auth/forgot-password', values).catch(() => undefined);
    setSent(true);
  });

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="displayMedium">Reset password</Text>
        <Text variant="bodyMedium" color="secondary">
          Enter your email and we&apos;ll send a reset link.
        </Text>
      </View>

      {sent ? (
        <Text variant="bodyMedium" color="secondary">
          If an account exists for that email, a reset link is on its way.
        </Text>
      ) : (
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
          <Button label="Send reset link" onPress={onSubmit} loading={isSubmitting} />
        </View>
      )}
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
