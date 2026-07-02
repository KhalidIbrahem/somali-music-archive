/**
 * Input — a labelled text field with an inline error slot, for forms built on
 * react-hook-form. Focus ring is always amber (ARCHITECTURE.md §7 border.focus).
 */

import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { colors, radius, spacing, typography, MIN_TOUCH_TARGET } from '@/theme';
import { Text } from './Text';

export interface InputProps extends TextInputProps {
  label: string;
  /**
   * Validation message shown below the field, if any. Typed `| undefined`
   * explicitly so callers can forward `errors.field?.message` (string | undefined)
   * directly under `exactOptionalPropertyTypes`.
   */
  error?: string | undefined;
}

export function Input({ label, error, style, ...rest }: InputProps): React.JSX.Element {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrapper}>
      <Text variant="labelLarge" color="secondary">
        {label}
      </Text>
      <TextInput
        style={[
          styles.input,
          focused ? styles.focused : null,
          error ? styles.errored : null,
          style,
        ]}
        placeholderTextColor={colors.text.tertiary}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={label}
        {...rest}
      />
      {error ? (
        <Text variant="bodySmall" color="error">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.xs,
  },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.primary,
    backgroundColor: colors.bg.secondary,
    paddingHorizontal: spacing.md,
    color: colors.text.primary,
    ...typography.bodyMedium,
  },
  focused: {
    borderColor: colors.border.focus,
  },
  errored: {
    borderColor: colors.error,
  },
});
