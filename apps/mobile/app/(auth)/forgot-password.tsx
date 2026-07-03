/**
 * Forgot-password screen (ARCHITECTURE.md §12 AUTH, §11).
 *
 * Sends a reset email, then shows a generic success state regardless of whether
 * the email is registered — this deliberately avoids leaking which addresses have
 * accounts (account-enumeration is an information leak, §11).
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@sma/validators';
import { Screen, Text, Input, Button, Card } from '@/components/ui';
import { forgotPassword } from '@/services/api/auth';
import { colors, spacing } from '@/theme';

export default function ForgotPassword(): React.JSX.Element {
  const [sentTo, setSentTo] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    // Always resolve to the same UI whether or not the email exists.
    await forgotPassword(values).catch(() => undefined);
    setSentTo(values.email);
  });

  if (sentTo) {
    return (
      <Screen>
        <View style={styles.successWrap}>
          <Card style={styles.successCard}>
            <View style={styles.successIcon}>
              <Ionicons name="mail-outline" size={32} color={colors.amber.primary} />
            </View>
            <Text variant="displaySmall" style={styles.center}>
              Check your email
            </Text>
            <Text variant="bodyMedium" color="secondary" style={styles.center}>
              If an account exists for {sentTo}, we&apos;ve sent a link to reset your password. It
              may take a few minutes to arrive.
            </Text>
          </Card>
          <Link href="/(auth)/login" asChild>
            <Button label="Back to sign in" variant="secondary" />
          </Link>
          <Button label="Resend link" variant="ghost" onPress={() => setSentTo(null)} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="displayMedium">Reset password</Text>
        <Text variant="bodyMedium" color="secondary">
          Enter your email and we&apos;ll send you a reset link.
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
              textContentType="emailAddress"
              error={errors.email?.message}
            />
          )}
        />
        <Button label="Send reset link" onPress={onSubmit} loading={isSubmitting} />
        <Link href="/(auth)/login" asChild>
          <Button label="Back to sign in" variant="ghost" />
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
  center: {
    textAlign: 'center',
  },
  successWrap: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.base,
  },
  successCard: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.amber.subtle,
  },
});
